import { AsyncMutex } from "../../core/services/support/async-mutex";
import type { HookName } from "../../core/hooks";
import type { HookEvent } from "../../core/hooks";
import type { PluginConfig } from "../../config/plugin-config";
import type { PluginHost } from "../host";
import type { PluginContext } from "./plugin-context";
import type { ResolvedPlugin } from "../manifest";

/**
 * One loaded plugin: its manifest, its host, its context, and the guarantee
 * that only one of its hooks runs at a time (D31).
 *
 * The serialisation is not caution about thread-safety — a worker has one event
 * loop already. It is what makes `PluginContext.depth` a sound single field:
 * the context serves callbacks *during* a dispatch, so with two dispatches in
 * flight one number could not say which one a callback belongs to, and a
 * plugin could escape the recursion limit by writing from the shallower of two
 * concurrent hooks. Serialising per plugin makes the answer unambiguous, and
 * costs nothing across plugins, which still run concurrently with each other.
 */
export class PluginRuntime {
  readonly name: string;
  readonly plugin: ResolvedPlugin;
  readonly config: PluginConfig;
  readonly hooks: readonly HookName[];

  private readonly host: PluginHost;
  private readonly context: PluginContext;
  private readonly mu = new AsyncMutex();

  constructor(
    plugin: ResolvedPlugin,
    config: PluginConfig,
    host: PluginHost,
    context: PluginContext,
    hooks: readonly HookName[]
  ) {
    this.plugin = plugin;
    this.config = config;
    this.name = config.name;
    this.host = host;
    this.context = context;
    this.hooks = hooks;
  }

  handles(hook: HookName): boolean {
    return this.hooks.includes(hook);
  }

  async dispatch(hook: HookName, event: HookEvent): Promise<unknown> {
    const release = await this.mu.acquire();
    this.context.depth = event.depth;
    try {
      return await this.host.dispatch(hook, event);
    } finally {
      this.context.depth = 0;
      release();
    }
  }

  async stop(): Promise<void> {
    await this.host.stop();
  }
}
