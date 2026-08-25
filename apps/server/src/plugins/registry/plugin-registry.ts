import path from "path";
import type { Hooks } from "../../core/hooks/hooks";
import { NoOpHooks } from "../../core/hooks/no-op-hooks";
import type { Config } from "../../config/config";
import type { SiloService } from "../../core/services/silo-service";
import type { Logger } from "../../logging/logger";
import { HookBus } from "../runtime";
import { PluginLoader } from "./plugin-loader";
import type { PluginRuntime } from "../runtime";

/**
 * The loaded plugins, and the one place anything asks about them (D31/§13).
 *
 * Built **explicitly** from `config.plugins`, in that array's order, at one wiring
 * site — never by plugins announcing themselves. That is what keeps §4's "no
 * `init()` registration magic, explicit construction only" true of a feature
 * whose whole job is to add things, and under the worker host it stops being a
 * convention: a side-effecting import in a plugin cannot reach the host's
 * objects at all.
 */
export class PluginRegistry {
  private readonly runtimes: readonly PluginRuntime[];
  private readonly bus: Hooks;

  private constructor(runtimes: readonly PluginRuntime[], logger: Logger) {
    this.runtimes = runtimes;
    // The null object when nothing is configured, so `SiloService` has one dispatch
    // path rather than five null checks (see NoOpHooks).
    this.bus = runtimes.length === 0 ? new NoOpHooks() : new HookBus(runtimes, logger);
  }

  /** Where plugins live: `<data dir>/plugins/`. In the data directory rather
   *  than beside the binary, which is root-owned and read-only when installed
   *  from a package — and because D5 makes an instance a directory you can
   *  `cp`, so an instance travels with its extensions. */
  static directory(config: Config): string {
    return path.join(config.storage.path, "plugins");
  }

  static empty(logger: Logger): PluginRegistry {
    return new PluginRegistry([], logger);
  }

  static async load(
    config: Config,
    service: SiloService,
    logger: Logger
  ): Promise<PluginRegistry> {
    if (config.plugins.length === 0) return PluginRegistry.empty(logger);

    const runtimes = await PluginLoader.loadExtensions({
      pluginsDir: PluginRegistry.directory(config),
      configs: config.plugins,
      service,
      logger,
    });
    return new PluginRegistry(runtimes, logger);
  }

  hooks(): Hooks {
    return this.bus;
  }

  list(): readonly PluginRuntime[] {
    return this.runtimes;
  }

  /** Tear every worker down. Called on shutdown so a detached server does not
   *  leave threads behind holding the data directory's run file hostage. */
  async stop(): Promise<void> {
    await Promise.all(this.runtimes.map((r) => r.stop().catch(() => {})));
  }
}
