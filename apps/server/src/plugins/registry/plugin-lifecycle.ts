import type { Config } from "../../config/config";
import type { PluginConfig } from "../../config/plugin-config";
import { PluginStartError } from "../../core/errors/plugin-start-error";
import type { PluginGrantRecord } from "../../core/plugins/plugin-grant-record";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import type { SiloService } from "../../core/services/silo-service";
import type { Logger } from "../../logging/logger";
import type { PluginRuntime } from "../runtime";
import { PluginGrantResolver } from "./plugin-grant-resolver";
import { PluginLoader } from "./plugin-loader";
import type { PluginLoadContext } from "./plugin-load-context";
import { PluginRegistry } from "./plugin-registry";

/**
 * Starting, stopping and re-authorising **one** plugin against the live set
 * (D39, phase 4).
 *
 * Split from `PluginSupervisor` because the two answer different questions.
 * This one answers "how does a plugin get into or out of the running set", and
 * has no opinion about when that should happen; the supervisor answers "in what
 * order do the steps of a management verb happen so that a failure leaves
 * something recoverable", and calls this. `PluginRescan` needs the first without
 * the second, which is what made the seam obvious.
 */
export class PluginLifecycle {
  private readonly registry: PluginRegistry;
  private readonly service: SiloService;
  private readonly logger: Logger;

  constructor(registry: PluginRegistry, service: SiloService, logger: Logger) {
    this.registry = registry;
    this.service = service;
    this.logger = logger;
  }

  /** Everything loading a plugin needs, rebuilt per call because a rescan may
   *  have replaced the config since the last one. */
  context(config: Config): PluginLoadContext {
    return {
      pluginsDir: PluginRegistry.directory(config),
      service: this.service,
      logger: this.logger,
      dispatcher: this.registry.api(),
    };
  }

  /**
   * Reconcile the record and start the worker, without inserting it. The caller
   * decides where it goes, because a rescan builds a whole ordered list and a
   * single `enable` slots into the one already there.
   *
   * `override` names the config document to run with when the caller knows
   * better than the record does — which is only `PluginConfigurator`, restarting
   * before it writes.
   */
  async start(
    config: Config,
    declared: PluginConfig,
    override?: Record<string, unknown>
  ): Promise<PluginRuntime | null> {
    const context = this.context(config);
    const prepared = await PluginLoader.prepare(context, declared);
    if (!prepared) return null;
    return await PluginLoader.start(
      context,
      declared,
      prepared.resolved,
      prepared.grant,
      override ?? PluginGrantUtils.configFor(prepared.grant, declared.config)
    );
  }

  /**
   * Start one plugin and put it in `silo.toml`'s position.
   *
   * Position and not the end, because the array's order **is** hook dispatch
   * order (§13.5): appending would make "which plugin sees a write first" depend
   * on the order an operator happened to enable things in, which is exactly the
   * load-order surprise config-owned ordering exists to prevent.
   */
  async spawn(
    config: Config,
    declared: PluginConfig,
    override?: Record<string, unknown>
  ): Promise<void> {
    // Wrapped here and not in `start`, which is deliberate: `PluginRescan` calls
    // `start` and catches failures into its report, while everything reaching
    // `spawn` is one caller asking for one plugin and waiting for the answer.
    // Boot keeps the plain error, because refusing the process with it on stderr
    // is already the right outcome there.
    let runtime;
    try {
      runtime = await this.start(config, declared, override);
    } catch (caught) {
      throw new PluginStartError(declared.name, caught);
    }
    if (!runtime) return;
    this.registry.replace(
      PluginLifecycle.ordered([...this.registry.list(), runtime], config)
    );
  }

  /** The config document a running worker was initialised with, or `null` when
   *  nothing is running under this name. */
  runtimeConfig(name: string): Record<string, unknown> | null {
    return this.registry.find(name)?.runtimeConfig ?? null;
  }

  /** Take a plugin out of the set and then tear its worker down. Out first, so
   *  no dispatch can select a runtime that is already stopping. */
  async remove(name: string): Promise<void> {
    const runtime = this.registry.find(name);
    if (!runtime) return;
    this.registry.replace(this.registry.list().filter((each) => each.name !== name));
    await runtime.stop().catch(() => {});
  }

  /**
   * Re-resolve one plugin's authority from its record and swap the cell (D39).
   *
   * Cannot throw. `PluginGrantResolver.resolve` refuses only a `silo.toml` that
   * grants past the manifest, and both of those were fixed at load, so a live
   * grant change has nothing left to reject. A hook that a narrowed grant no
   * longer delivers is **warned about rather than refused**: refusing would make
   * a plugin impossible to revoke, and a deliberate narrowing is not the
   * misconfiguration `PluginLoader.assertDeliverable` exists to catch.
   */
  reapply(name: string, record: PluginGrantRecord | null): void {
    const runtime = this.registry.find(name);
    if (!runtime) return;

    const authority = PluginGrantResolver.resolve(runtime.config, runtime.plugin.manifest, record);
    runtime.useAuthority(authority);

    if (authority.claims.length > 0 && authority.undeliverable.length > 0) {
      this.logger.warn("plugin has declared hooks that nothing now delivers", {
        plugin: name,
        hooks: authority.undeliverable.join(","),
      });
    }
    this.logger.info("plugin authority changed", {
      plugin: name,
      state: authority.state,
      claims: authority.claims.length,
    });
  }

  private static ordered(
    runtimes: readonly PluginRuntime[],
    config: Config
  ): readonly PluginRuntime[] {
    const position = new Map(config.plugins.map((plugin, index) => [plugin.name, index]));
    return [...runtimes].sort(
      (a, b) => (position.get(a.name) ?? 0) - (position.get(b.name) ?? 0)
    );
  }
}
