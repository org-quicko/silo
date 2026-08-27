import { ValidationError } from "@silo/shared/validation-error";
import type { Config } from "../../config/config";
import type { PluginConfig } from "../../config/plugin-config";
import { NotFoundError } from "../../core/errors/not-found-error";
import type { PluginGrantRecord } from "../../core/plugins/plugin-grant-record";
import { AsyncMutex } from "../../core/services/support/async-mutex";
import { PluginGrantService } from "../../core/services/plugin-grant-service";
import type { GrantRequest } from "../../core/services/support/grant-request";
import type { SiloService } from "../../core/services/silo-service";
import type { Logger } from "../../logging/logger";
import type { PluginRuntime } from "../runtime/plugin-runtime";
import { PluginConfigurator } from "./plugin-configurator";
import type { PluginFacts } from "./plugin-facts";
import { PluginInspector } from "./plugin-inspector";
import { PluginInstallation } from "./plugin-installation";
import type { PluginInstallOptions, PluginInstallOutcome } from "./plugin-installation";
import { PluginUninstallation } from "./plugin-uninstallation";
import type { PluginUninstallOutcome } from "./plugin-uninstallation";
import { PluginLifecycle } from "./plugin-lifecycle";
import { PluginPanel } from "./plugin-panel";
import type { PluginPanelSource } from "./plugin-panel";
import { PluginRegistry } from "./plugin-registry";
import { PluginRescan } from "./plugin-rescan";
import type { PluginStatus } from "./plugin-status";
import type { RescanReport } from "./rescan-report";

export interface PluginSupervisorOptions {
  registry: PluginRegistry;
  service: SiloService;
  logger: Logger;
  /** The config in force. Replaced by a rescan, which is the only thing that
   *  may re-read the operator's file. */
  config: Config;
  /** Re-read `silo.toml` exactly as this process was started with it, flags and
   *  environment included. Absent in a process that was never handed one — an
   *  embedder, a test — where `rescan` refuses rather than guessing. */
  reload?: () => Promise<Config>;
  /** Path to `silo.toml` if available, so newly installed plugins can be appended. */
  configPath?: string;
}

/**
 * Live install, uninstall, enable, disable, revoke, reconfigure and rescan
 * (D39, phase 4).
 *
 * Before this, every management verb ended in "restart to find out". A grant was
 * resolved once at load and held in two places, so `DELETE .../grant` destroyed
 * the managed key while the running plugin kept acting on the claims it had
 * loaded with — measured live in phase 3, and deliberately left whole rather
 * than half-fixed, because a plugin whose `ctx` is dead while its hooks still
 * fire is a *new* inconsistent state rather than a smaller bug. The cure for
 * that half is `PluginAuthority`: one cell, two readers, one assignment.
 *
 * Everything else here is process lifecycle, and it obeys one rule:
 *
 * > **The record must never describe a state the next `serve` cannot reach.**
 *
 * That settles every ordering question, and it does not always point the same
 * way. Enabling starts the worker *before* writing, because a record saying
 * `enabled: true` for a package that cannot load would make the next start
 * refuse the whole instance — a failed API call turning into an unbootable
 * server. Disabling writes *before* stopping, because a refused write must not
 * leave a stopped plugin behind whose restart could itself fail. D38 found the
 * same shape inside `grant`, where only mint → write → discard is safe at every
 * step.
 *
 * Every operation runs under one mutex — not for the store, which has its own
 * write lock, but because these compose: an `enable` and a `rescan` that
 * interleaved would both decide what the ordered set is, and one would win by
 * accident.
 */
export class PluginSupervisor {
  private readonly registry: PluginRegistry;
  private readonly service: SiloService;
  private readonly logger: Logger;
  private readonly lifecycle: PluginLifecycle;
  private readonly configurator: PluginConfigurator;
  private readonly reload?: () => Promise<Config>;
  private readonly configPath?: string;
  private readonly lock = new AsyncMutex();

  private config: Config;

  constructor(options: PluginSupervisorOptions) {
    this.registry = options.registry;
    this.service = options.service;
    this.logger = options.logger;
    this.config = options.config;
    this.reload = options.reload;
    this.configPath = options.configPath;
    this.lifecycle = new PluginLifecycle(options.registry, options.service, options.logger);
    this.configurator = new PluginConfigurator(this.lifecycle, options.service);
  }

  /** Approve or narrow a grant, taking effect on the next hook and the next
   *  `ctx.fetch` rather than at the next start. */
  async grant(
    name: string,
    claims: readonly string[],
    request: GrantRequest
  ): Promise<PluginGrantRecord> {
    return await this.serialized(async () => {
      const record = await this.service.plugins.grant(name, claims, request);
      this.lifecycle.reapply(name, record);
      return record;
    });
  }

  /**
   * Withdraw a grant, live.
   *
   * The write goes first and the authority swap follows, so a refused write
   * changes nothing — and the swap happens before the response returns, which is
   * the whole of §13.11's acceptance test: revoke, and both `ctx` calls and hook
   * delivery have already stopped by the time the caller reads the answer.
   */
  async revoke(name: string, request: GrantRequest): Promise<PluginGrantRecord> {
    return await this.serialized(async () => {
      const record = await this.service.plugins.revoke(name, request);
      this.lifecycle.reapply(name, record);
      return record;
    });
  }

  /** Start or stop a plugin now. See the class comment for why the two halves
   *  order their steps differently. */
  async setEnabled(
    name: string,
    enabled: boolean,
    request: GrantRequest
  ): Promise<PluginGrantRecord> {
    return await this.serialized(async () => {
      const current = await this.require(name);
      // The cheap refusal first, so a stale `If-Match` never gets as far as
      // starting a worker it would immediately have to stop. `write` checks it
      // again under the store's lock, which is the authoritative one — the same
      // split `revoke` already makes for the same reason.
      PluginGrantService.assertRev(name, current.rev, request.expectedRev);
      return enabled ? await this.enable(name, request) : await this.disable(name, request);
    });
  }

  /** Change what a plugin is configured with, without editing `silo.toml`.
   *  See `PluginConfigurator` for what an override does to the file's block. */
  async configure(
    name: string,
    patch: Record<string, unknown>,
    request: GrantRequest
  ): Promise<PluginGrantRecord> {
    return await this.serialized(async () => {
      const declared = this.declared(name);
      const current = await this.require(name);
      PluginGrantService.assertRev(name, current.rev, request.expectedRev);
      return await this.configurator.patch(this.config, declared, current, patch, request);
    });
  }

  /** Drop the config override and go back to what `silo.toml` says. */
  async clearConfig(name: string, request: GrantRequest): Promise<PluginGrantRecord> {
    return await this.serialized(async () => {
      const declared = this.declared(name);
      const current = await this.require(name);
      PluginGrantService.assertRev(name, current.rev, request.expectedRev);
      return await this.configurator.clear(this.config, declared, current, request);
    });
  }

  /**
   * Tear a plugin's worker down and bring it back.
   *
   * The answer to a dead worker. `WorkerHost` does not respawn one — a plugin
   * that missed its budget is usually still spinning, so an automatic restart
   * walks into the same wall while hiding that anything happened (§13.9) — and
   * until phase 4 that left the kill permanent *and* silent. It is still not
   * automatic; it is now something an operator can ask for, having read why it
   * died.
   *
   * No `If-Match`, because it writes no record: there is no revision anybody
   * could be approving, and requiring one would be the ceremony §13.14 says
   * `If-Match` is not.
   */
  async restart(name: string): Promise<PluginStatus> {
    return await this.serialized(async () => {
      const declared = this.declared(name);
      const record = await this.service.plugins.find(name);
      if (record?.enabled === false) {
        throw new ValidationError(
          `plugin "${name}" is disabled, so there is nothing to restart. ` +
            `POST /api/plugins/${name}/enable starts it.`
        );
      }
      await this.lifecycle.remove(name);
      await this.lifecycle.spawn(this.config, declared);
      return await this.status(name, record);
    });
  }

  /**
   * Re-read `silo.toml` and make the running set match it.
   *
   * It reaches the filesystem to read the **operator's own file**, which is why
   * it never breached D34's split: an API that applies a block the operator
   * already wrote runs exactly what a restart would have, sooner. `install` is
   * the verb that goes further and *writes* one, and it is guarded by the same
   * claim for the same reason — rescan already ran arbitrary listed code, so
   * "may this caller decide whether plugin code runs" has one answer, not two.
   */
  async rescan(): Promise<RescanReport> {
    return await this.serialized(async () => {
      if (!this.reload) {
        throw new ValidationError(
          `this process was not started from a config file, so there is nothing to rescan.`
        );
      }
      // Re-read first, and let a broken file stop this before anything is
      // touched: a config that does not parse is not a set of plugins, and
      // applying half of one would be worse than applying none.
      //
      // The parse error is re-thrown as a refusal so it reaches the caller
      // *whole*. `ConfigLoader` throws a plain `Error`, which the HTTP layer
      // turns into `internal error` with no detail — and "internal error" is the
      // least useful thing to say to someone who has just mistyped a
      // `[[plugins]]` block, since the message they need is the one being
      // discarded. Measured on a running instance, which is the only place it
      // showed.
      let config: Config;
      try {
        config = await this.reload();
      } catch (caught) {
        throw new ValidationError(
          `the config file could not be read, so nothing was changed: ${(caught as Error).message}`
        );
      }
      const report = await PluginRescan.run({
        lifecycle: this.lifecycle,
        registry: this.registry,
        config,
      });
      this.config = config;
      this.logger.info("plugins rescanned", {
        started: report.started.join(",") || "-",
        restarted: report.restarted.join(",") || "-",
        stopped: report.stopped.join(",") || "-",
        failed: report.failed.map((failure) => failure.name).join(",") || "-",
      });
      return report;
    });
  }

  /**
   * Acquire a package, start it, authorize it and list it — see
   * `PluginInstallation`, which owns the order those happen in and the reasons
   * for it.
   *
   * Under the same mutex as everything else here, and for a sharper version of
   * the same reason: an install decides what the ordered set is *and* writes to
   * `silo.toml`, so one interleaved with a `rescan` would have the rescan read a
   * file the install had half-written.
   *
   * The config in force is replaced from the outcome rather than re-read. The
   * block that was appended is the block that was spawned, so a reload could
   * only agree — at the cost of a second failure mode (a file that stopped
   * parsing between the two) on the one path where there is nothing left to
   * undo.
   */
  async install(
    options: PluginInstallOptions,
    request: GrantRequest
  ): Promise<PluginInstallOutcome> {
    return await this.serialized(async () => {
      const outcome = await PluginInstallation.run({
        lifecycle: this.lifecycle,
        registry: this.registry,
        service: this.service,
        logger: this.logger,
        config: this.config,
        configPath: this.configPath,
        install: options,
        request,
      });
      this.config = outcome.config;
      return outcome;
    });
  }

  /**
   * Take a plugin off this instance — see `PluginUninstallation`, which owns
   * the order and the reasons for it (D43).
   *
   * Serialized like everything else here, and this is the verb where that
   * matters most: it edits `silo.toml` *and* mutates the running set *and*
   * deletes a record, so one interleaved with a `rescan` would have the rescan
   * re-start a plugin from a file the uninstall had already half-rewritten.
   */
  async uninstall(name: string, request: GrantRequest): Promise<PluginUninstallOutcome> {
    return await this.serialized(async () => {
      const outcome = await PluginUninstallation.run({
        lifecycle: this.lifecycle,
        registry: this.registry,
        service: this.service,
        logger: this.logger,
        config: this.config,
        configPath: this.configPath,
        name,
        request,
      });
      this.config = outcome.config;
      return outcome;
    });
  }

  /** Everything about one plugin the record cannot carry: what it is doing,
   *  what its package declares, and the config in force — see `PluginInspector`,
   *  which is the half of this class that changes nothing. */
  async inspect(name: string, record: PluginGrantRecord | null): Promise<PluginFacts> {
    return await PluginInspector.inspect(this.config, this.registry, name, record);
  }

  /** What a plugin is doing, as opposed to what its record says. */
  async status(name: string, record: PluginGrantRecord | null): Promise<PluginStatus> {
    return await PluginInspector.status(this.config, this.registry, name, record);
  }

  /**
   * A plugin's declared admin panel (D41).
   *
   * Through the supervisor because it is the holder of the config in force, and
   * a rescan replaces that — so a panel added to `silo.toml` becomes readable at
   * the same moment its routes do. Deliberately **not** gated on the plugin
   * running: a panel whose plugin is stopped still renders, and what it renders
   * is its own routes failing, which is more useful than a blank screen beside a
   * runtime pill that already says `stopped`.
   */
  async panel(name: string): Promise<PluginPanelSource> {
    return await PluginPanel.read(this.config, name);
  }

  /**
   * The loaded plugin of that name, or `undefined` (D36, phase 6).
   *
   * Asked **per request** by `ExtRoutes`, and that is the point: only this class
   * mutates the registry, so a lookup that goes through it sees enable, disable,
   * revoke and rescan the moment they happen. A route table captured at boot
   * would have made plugin routes the one surface where phase 4 did not apply.
   */
  runtime(name: string): PluginRuntime | undefined {
    return this.registry.find(name);
  }

  /** Start a plugin the operator just enabled: worker first, record second. */
  private async enable(name: string, request: GrantRequest): Promise<PluginGrantRecord> {
    // A record with no `[[plugins]]` block cannot be started, and will not be
    // started by the next `serve` either — so writing the intent is both
    // harmless and truthful: the operator is saying "when this is listed, run
    // it". `status` reports why nothing came up.
    const declared = this.config.plugins.find((plugin) => plugin.name === name);
    if (declared && !this.registry.find(name)) await this.lifecycle.spawn(this.config, declared);

    try {
      return await this.service.plugins.setEnabled(name, true, request);
    } catch (caught) {
      // The write lost the race for the revision after all. Undo the start —
      // stopping cannot fail, which is exactly why starting went first.
      await this.lifecycle.remove(name).catch(() => {});
      throw caught;
    }
  }

  /** Stop a plugin: record first, worker second. Reversing it would risk a
   *  refused write leaving a stopped plugin whose restart could itself fail. */
  private async disable(name: string, request: GrantRequest): Promise<PluginGrantRecord> {
    const record = await this.service.plugins.setEnabled(name, false, request);
    await this.lifecycle.remove(name);
    return record;
  }

  private declared(name: string): PluginConfig {
    const declared = this.config.plugins.find((plugin) => plugin.name === name);
    if (!declared) {
      throw new NotFoundError(
        `plugin "${name}" is not listed in silo.toml, so this instance has nothing to ` +
          `configure or run for it. Listing a plugin is what makes it loadable; this API ` +
          `decides what a listed one may do.`
      );
    }
    return declared;
  }

  private async require(name: string): Promise<PluginGrantRecord> {
    const record = await this.service.plugins.find(name);
    if (!record) throw new NotFoundError(`plugin "${name}" has no record on this instance.`);
    return record;
  }

  private async serialized<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.lock.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }
}
