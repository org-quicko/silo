import path from "path";
import type { Hono } from "hono";
import type { Hooks } from "../../core/hooks/hooks";
import type { Config } from "../../config/config";
import type { SiloService } from "../../core/services/silo-service";
import type { Logger } from "../../logging/logger";
import { HookBus, PluginApiDispatcher } from "../runtime";
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
 *
 * Since phase 4 the list is **mutable, and only `PluginSupervisor` mutates it**
 * (D39). This class stays the answer to "what is loaded, in what order"; the
 * supervisor is the answer to "what changes it, and in what order do the steps
 * happen". Splitting them keeps the thing everything reads small enough to be
 * obviously correct, and puts every rule about ordering and rollback in one file
 * instead of scattered across the readers.
 */
export class PluginRegistry {
  private runtimes: readonly PluginRuntime[] = [];
  private readonly bus: HookBus;
  private readonly dispatcher: PluginApiDispatcher;

  constructor(logger: Logger, dispatcher = new PluginApiDispatcher()) {
    this.dispatcher = dispatcher;
    // One real bus, always, reading the list through a supplier. Before phase 4
    // an empty registry substituted `NoOpHooks` to save five null checks; a
    // registry that can *stop* being empty cannot, because whatever
    // `SiloService.useHooks` was handed at boot is what it dispatches through
    // forever. An empty loop costs nothing, and there is now one dispatch path
    // rather than two that must agree.
    this.bus = new HookBus(() => this.runtimes, logger);
  }

  /** Where plugins live: `<data dir>/plugins/`. In the data directory rather
   *  than beside the binary, which is root-owned and read-only when installed
   *  from a package — and because D5 makes an instance a directory you can
   *  `cp`, so an instance travels with its extensions. */
  static directory(config: Config): string {
    return path.join(config.storage.path, "plugins");
  }

  static empty(logger: Logger): PluginRegistry {
    return new PluginRegistry(logger);
  }

  static async load(
    config: Config,
    service: SiloService,
    logger: Logger
  ): Promise<PluginRegistry> {
    const registry = new PluginRegistry(logger);
    registry.replace(
      await PluginLoader.loadExtensions({
        pluginsDir: PluginRegistry.directory(config),
        configs: config.plugins,
        service,
        logger,
        dispatcher: registry.dispatcher,
      })
    );
    return registry;
  }

  hooks(): Hooks {
    return this.bus;
  }

  /** The dispatcher every plugin's `ctx.fetch` lands on, so the supervisor can
   *  hand it to a plugin it starts after the server already exists. */
  api(): PluginApiDispatcher {
    return this.dispatcher;
  }

  /**
   * Hand the plugins the HTTP surface their `ctx.fetch` dispatches against
   * (D35).
   *
   * A second step rather than a constructor argument because of the order the
   * two are built in: extensions load in `SiloRuntime` so `SiloService` can be
   * given their hook bus, and the server is built from that service afterwards.
   * Nothing can dispatch in between — a hook only fires from a request, and
   * there are no requests before the app exists — so the window is real but
   * empty, and a dispatcher nobody attached refuses with a sentence rather than
   * a 404.
   */
  attach(app: Hono): void {
    this.dispatcher.attach(app);
  }

  /**
   * Run `activate(ctx)` on every plugin that declared a runtime and has not been
   * activated yet (D36).
   *
   * Its own step, driven from where the app is attached, because activation is
   * the first moment a plugin may *act*: `activate` may call `ctx`, and at boot
   * the plugins are loaded before the Hono app they would dispatch against
   * exists. Starting the worker and letting it act are therefore two different
   * events, and only the second one has a prerequisite.
   *
   * Idempotent, and that is what lets there be two callers — this pass at boot,
   * and `PluginLifecycle.spawn` for a plugin enabled on a running instance —
   * without either having to know whether the other already ran. In order, and
   * awaited: `silo.toml`'s order is the dispatch order, and a plugin whose
   * `activate` seeds a collection another plugin's `activate` reads should see
   * the same sequence a hook would.
   */
  async activate(): Promise<void> {
    for (const runtime of this.runtimes) await runtime.activate();
  }

  list(): readonly PluginRuntime[] {
    return this.runtimes;
  }

  find(name: string): PluginRuntime | undefined {
    return this.runtimes.find((runtime) => runtime.name === name);
  }

  /**
   * Install a new ordered set (D39).
   *
   * Whole-list replacement rather than add/remove, because the order **is** the
   * dispatch order and a per-plugin mutation would have to say where a plugin
   * goes — a question `silo.toml` has already answered and no caller should get
   * to answer differently. Assignment, so a dispatch already iterating the old
   * array finishes against a consistent set instead of one shifting underneath
   * it.
   */
  replace(runtimes: readonly PluginRuntime[]): void {
    this.runtimes = [...runtimes];
  }

  /** Tear every worker down. Called on shutdown so a detached server does not
   *  leave threads behind holding the data directory's run file hostage. */
  async stop(): Promise<void> {
    const running = this.runtimes;
    this.runtimes = [];
    await Promise.all(running.map((r) => r.stop().catch(() => {})));
  }
}
