import { Claims } from "@silo/shared/claims";
import type { Claim } from "@silo/shared/claim";
import { ValidationError } from "@silo/shared/validation-error";
import type { Config } from "../../config/config";
import type { PluginConfig } from "../../config/plugin-config";
import { PluginBlockWriter } from "../../config/plugin-block-writer";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import type { PluginGrantRecord } from "../../core/plugins/plugin-grant-record";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import type { GrantRequest } from "../../core/services/support/grant-request";
import type { SiloService } from "../../core/services/silo-service";
import type { Logger } from "../../logging/logger";
import { PluginInstaller, type InstallResult } from "../install/plugin-installer";
import { PluginContributionUtils } from "../manifest";
import { PluginGrantResolver } from "./plugin-grant-resolver";
import type { PluginLifecycle } from "./plugin-lifecycle";
import { PluginRegistry } from "./plugin-registry";

/** What a caller asks `POST /api/plugins/install` for. */
export interface PluginInstallOptions {
  spec: string;
  ref?: string;
  integrity?: string;
  registry?: string;
  force?: boolean;
  /** Omitted means "everything the package says it requires", which is the same
   *  default `PUT .../grant` and `silo add` take. */
  claims?: readonly string[];
  timeout_ms?: number;
  on_error?: "fail" | "skip";
}

export interface PluginInstallOutcome {
  name: string;
  installed: InstallResult;
  /** `null` for a package that contributes only providers: there is no worker to
   *  authorize and therefore no record (§13.7). */
  record: PluginGrantRecord | null;
  /** The block this instance is now running the plugin with. */
  declared: PluginConfig;
  /** The config in force once the plugin is listed — the supervisor's next
   *  `this.config`. */
  config: Config;
  warnings: string[];
}

export interface PluginInstallationOptions {
  lifecycle: PluginLifecycle;
  registry: PluginRegistry;
  service: SiloService;
  logger: Logger;
  config: Config;
  /** Path to `silo.toml`, when this process was started from one. */
  configPath?: string;
  install: PluginInstallOptions;
  /** The authority and identity of whoever asked. */
  request: GrantRequest;
}

/**
 * Acquiring a package and adopting it, in one operation.
 *
 * D34 reserved `/api/plugins/*` for **grants and lifecycle** on the argument
 * that an API able to write a `[[plugins]]` block is a code-execution primitive
 * wearing a management claim. That argument still holds; what changed is that
 * `plugins:enable` is now *stated* to be that primitive — it already was, since
 * `rescan` runs whatever the file says — and so the block this writes is
 * deliberately the **weakest one that can exist**:
 *
 * > `claims = []`, always. Registration goes in the operator's file;
 * > authorization goes in the `_plugins` record.
 *
 * That is not a stylistic choice. Effective authority is the file **unioned**
 * with the record (`PluginGrantResolver.effective`), and only the record half
 * passes through `assertGrantable` and `canDelegate`. A block carrying claims
 * would therefore be a grant no check ever sees — on this install and on every
 * start afterwards. Writing `[]` keeps every claim on the audited, revocable
 * path, so `DELETE .../grant` still means something the next morning.
 *
 * The order of operations is the rest of it, and it follows `PluginSupervisor`'s
 * rule — *the record must never describe a state the next `serve` cannot reach*:
 *
 *  1. **Refuse before fetching** what can be refused without the manifest. An
 *     over-broad `claims` never reaches the network.
 *  2. Install to disk, which is where the manifest comes from.
 *  3. **Refuse before running** everything the manifest decides.
 *  4. Start the worker, still ungranted.
 *  5. Grant, which mints the key and swaps the authority live.
 *  6. **Write the block last.** A `[[plugins]]` entry for a package that could
 *     not start would make the next `serve` refuse the whole instance — a failed
 *     API call turning into an unbootable server, which is the exact outcome
 *     `PluginSupervisor.enable` orders its own steps to avoid. Every step before
 *     this one is undone on failure; this one has nothing after it to fail.
 */
export class PluginInstallation {
  static async run(options: PluginInstallationOptions): Promise<PluginInstallOutcome> {
    const wanted = options.install;
    const spec = typeof wanted.spec === "string" ? wanted.spec.trim() : "";
    if (!spec) throw new ValidationError("plugin spec is required");

    // The two refusals that do not need a manifest, before anything is fetched.
    // A caller naming claims it cannot delegate is refused without a byte
    // crossing the network, and without a package on disk to explain away.
    if (wanted.claims !== undefined) {
      PluginInstallation.assertAskable(Claims.normalize([...wanted.claims]), options.request);
    }

    const pluginsDir = PluginRegistry.directory(options.config);
    let installed: InstallResult;
    try {
      installed = await PluginInstaller.install({
        pluginsDir,
        spec,
        ref: wanted.ref,
        integrity: wanted.integrity,
        registry: wanted.registry,
        force: wanted.force,
      });
    } catch (caught) {
      // `PluginInstaller` throws plain `Error`s for operator mistakes — a bad
      // spec, a digest that does not match, a package already installed. As
      // `internal error` they would all read the same; as refusals they say
      // which.
      throw new ValidationError(PluginInstallation.message(caught));
    }

    try {
      return await PluginInstallation.adopt(options, installed);
    } catch (caught) {
      await PluginInstallation.undo(options, installed);
      throw caught;
    }
  }

  /** Everything after the package is on disk: judge it, run it, authorize it,
   *  and only then list it. */
  private static async adopt(
    options: PluginInstallationOptions,
    installed: InstallResult
  ): Promise<PluginInstallOutcome> {
    const { name, manifest } = installed;
    const wanted = options.install;
    const request = PluginGrantResolver.request(manifest);

    // `request.required` and not `PluginPermissionUtils.requiredClaims`: the
    // derived claims — `http:route`, one per declared hook — are required too,
    // and a default that omitted them would start a plugin whose routes all
    // answer 403 and whose hooks never fire, if `assertServable` let it start at
    // all. Measured: it did not, and the block had already been written.
    const claims =
      wanted.claims !== undefined ? Claims.normalize([...wanted.claims]) : request.required;

    PluginInstallation.assertWithinRequest(name, request.claims, claims);
    PluginGrantUtils.assertGrantable(name, claims);
    PluginInstallation.assertCovers(name, request.required, claims);
    PluginInstallation.assertDelegable(name, claims, options.request);

    const declared = PluginInstallation.declare(options, name);
    const config: Config = options.config.plugins.some((plugin) => plugin.name === name)
      ? options.config
      : // Appended, because the array's order **is** hook dispatch order (§13.5)
        // and a newly installed plugin dispatching last is the only defensible
        // default — the same position `PluginBlockWriter.append` gives it in the
        // file, so the two never disagree.
        { ...options.config, plugins: [...options.config.plugins, declared] };

    // A package contributing only providers has no worker and therefore no
    // record: a provider is constructed before the store exists, so it cannot be
    // authorized from inside it (§13.7). Listing it is the whole of what this can
    // do for one, and saying so is better than starting nothing in silence.
    const runs = PluginContributionUtils.runsInWorker(manifest.contributes);
    const warnings = [...installed.warnings];

    if (runs) {
      if (options.registry.find(name)) await options.lifecycle.remove(name);
      await options.lifecycle.spawn(config, declared);
    } else {
      warnings.push(
        `${name} contributes only providers, which are constructed before storage opens — ` +
          `it takes effect at the next start, not now.`
      );
    }

    // Granted after the worker is up, because the record `grant` writes to is the
    // one `prepare` wrote on the way. The worker runs ungranted for the length of
    // this call, which is the state every plugin awaiting approval is in at every
    // boot, and `reapply` swaps the authority in before anyone is told the
    // install succeeded.
    let record = runs ? await options.service.plugins.find(name) : null;
    if (record && claims.length > 0) {
      record = await options.service.plugins.grant(name, claims, options.request);
      options.lifecycle.reapply(name, record);
    }

    const unlisted = await PluginInstallation.list(options, name, declared);
    if (unlisted) warnings.push(unlisted);

    options.logger.info("plugin installed", {
      name,
      source: installed.source.kind,
      resolved: installed.resolved,
      claims: claims.length,
    });

    return { name, installed, record, declared, config, warnings };
  }

  /**
   * The block to run with.
   *
   * An entry the operator already wrote wins over silo's defaults, which is the
   * rule `silo add` states when it leaves an existing entry alone: its claims and
   * its position in the dispatch order were a decision, and re-installing a
   * package is not a reason to overrule it.
   */
  private static declare(options: PluginInstallationOptions, name: string): PluginConfig {
    const existing = options.config.plugins.find((plugin) => plugin.name === name);
    if (existing) return existing;

    const declared = PluginBlockWriter.defaults(name, []);
    const timeout = Number(options.install.timeout_ms);
    if (Number.isFinite(timeout) && timeout > 0) declared.timeout_ms = timeout;
    if (options.install.on_error === "skip" || options.install.on_error === "fail") {
      declared.on_error = options.install.on_error;
    }
    return declared;
  }

  /**
   * Append the `[[plugins]]` block, returning what could not be done rather than
   * throwing.
   *
   * Last, and forgiving, for the same reason: everything that matters has already
   * happened. A plugin running but unlisted comes back at the next start as one
   * that is installed and granted but not loaded — recoverable, and reported. A
   * plugin listed but unrunnable does not come back at all.
   */
  private static async list(
    options: PluginInstallationOptions,
    name: string,
    declared: PluginConfig
  ): Promise<string | null> {
    if (!options.configPath) {
      return (
        `this process was not started from a config file, so ${name} is running but not ` +
        `listed — it will not come back at the next start.`
      );
    }
    if (!(await PluginBlockWriter.exists(options.configPath))) {
      return (
        `there is no ${options.configPath} to list ${name} in, so it will not come back at ` +
        `the next start.`
      );
    }
    if (await PluginBlockWriter.names(options.configPath, name)) return null;

    try {
      await PluginBlockWriter.append(
        options.configPath,
        PluginBlockWriter.render(
          declared,
          `Added by POST /api/plugins/install. Its claims live in the plugins record, not ` +
            `here — see GET /api/plugins/${name}.`
        )
      );
      return null;
    } catch (caught) {
      return (
        `${name} is running, but ${options.configPath} could not be written ` +
        `(${PluginInstallation.message(caught)}), so it will not come back at the next start.`
      );
    }
  }

  /**
   * Put the package back the way it was found.
   *
   * Only when this operation created the directory. A `--force` install has
   * already deleted whatever was there, and removing the replacement would leave
   * the operator with neither version — so the new package stays on disk,
   * stopped and unlisted, and the refusal that brought us here is what explains
   * why.
   */
  private static async undo(
    options: PluginInstallationOptions,
    installed: InstallResult
  ): Promise<void> {
    await options.lifecycle.remove(installed.name).catch(() => {});
    if (installed.replaced) return;
    await PluginInstaller.uninstall(
      PluginRegistry.directory(options.config),
      installed.name
    ).catch(() => {});
  }

  /**
   * The refusals that can be made before there is a package, worded for a caller
   * who has not got one yet.
   *
   * `assertGrantable` and `assertDelegable` say the same two things about a
   * *named* plugin, and are still the authoritative pass — this one runs earlier,
   * on the claims alone, so a request that is going to be refused does not first
   * download and unpack third-party code. Only a caller who typed `claims`
   * reaches it: a default is derived from a manifest, which does not exist yet.
   *
   * It reads the same `PluginForbiddenClaims` vocabulary rather than restating
   * it — one list, two sentences about it.
   */
  private static assertAskable(claims: readonly string[], request: GrantRequest): void {
    if (claims.includes(Claims.Root)) {
      throw new ValidationError(
        `no plugin can be granted root: a plugin runs code, so root would include the ` +
          `authority to widen its own grant. Name the claims it needs. Nothing was installed.`
      );
    }

    const forbidden = claims.filter((claim) =>
      (Claims.PluginForbiddenClaims as readonly string[]).includes(claim)
    );
    if (forbidden.length > 0) {
      throw new ValidationError(
        `no plugin can be granted ${forbidden.join(", ")}: a plugin holding these could step ` +
          `outside its own grant — by widening the record, or by minting or planting a ` +
          `credential the record does not bound. Nothing was installed.`
      );
    }

    if (request.claims && !Claims.canDelegate(request.claims, claims as Claim[])) {
      throw new ForbiddenError(
        `this key cannot grant a plugin more authority than it holds itself. Nothing was ` +
          `installed.`
      );
    }
  }

  /** Nothing past what the manifest asked for. The bound
   *  `PluginGrantService.grant` puts on the record, applied before the package
   *  is running rather than after. */
  private static assertWithinRequest(
    name: string,
    requested: readonly string[],
    claims: readonly string[]
  ): void {
    const excess = PluginGrantUtils.ungranted(requested, claims);
    if (excess.length === 0) return;
    throw new ValidationError(
      `plugin "${name}" did not request ${excess.join(", ")}. A grant may not exceed what ` +
        `the manifest asks for — otherwise what an operator approves and what the package ` +
        `declared are two different lists.`
    );
  }

  /** Nothing less than what the package says it cannot work without: `serve`
   *  would refuse to start on such a grant, so writing one is worse than
   *  writing none. */
  private static assertCovers(
    name: string,
    required: readonly string[],
    claims: readonly string[]
  ): void {
    const unmet = PluginGrantUtils.missing(required, claims);
    if (unmet.length === 0) return;
    throw new ValidationError(
      `plugin "${name}" requires ${unmet.join(", ")}, which the claims given do not cover. ` +
        `serve would refuse to start it with that grant, so it was not installed.`
    );
  }

  /**
   * Nothing the caller does not itself hold.
   *
   * The check `PluginGrantService.grant` makes, hoisted to where it can still
   * refuse. Left only there, it fired **after** the worker was running and the
   * block was written: the caller read a 403 while the plugin it had just
   * installed served requests on claims that key could not delegate — and it
   * came back on the next start.
   */
  private static assertDelegable(
    name: string,
    claims: readonly string[],
    request: GrantRequest
  ): void {
    if (!request.claims) return;
    if (Claims.canDelegate(request.claims, claims as Claim[])) return;
    throw new ForbiddenError(
      `this key cannot grant plugin "${name}" more authority than it holds itself`
    );
  }

  private static message(caught: unknown): string {
    return caught instanceof Error ? caught.message : String(caught);
  }
}
