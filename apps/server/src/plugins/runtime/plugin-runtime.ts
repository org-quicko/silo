import type { HookName } from "../../core/hooks";
import type { HookEvent } from "../../core/hooks";
import type { PluginConfig } from "../../config/plugin-config";
import type { PluginHost } from "../host";
import type { ResolvedPlugin } from "../manifest";

/**
 * One loaded plugin: its manifest, its host, and the hooks it answers to (D31).
 *
 * Dispatches are **not** serialised per plugin. They were, to make
 * `PluginContext.depth` a sound single field while a context served callbacks
 * mid-dispatch — and that mutex deadlocked the thing it was protecting: a hook
 * writing through `ctx` re-entered its own runtime and blocked on a lock its
 * own caller held, until the dispatch timed out and the worker was destroyed
 * (D33). Correlating each callback with its dispatch removes the ambiguity the
 * lock existed for, so the lock is gone rather than made re-entrant.
 */
export class PluginRuntime {
  readonly name: string;
  readonly plugin: ResolvedPlugin;
  readonly config: PluginConfig;
  readonly hooks: readonly HookName[];

  private readonly host: PluginHost;

  constructor(
    plugin: ResolvedPlugin,
    config: PluginConfig,
    host: PluginHost,
    hooks: readonly HookName[]
  ) {
    this.plugin = plugin;
    this.config = config;
    this.name = config.name;
    this.host = host;
    this.hooks = hooks;
  }

  handles(hook: HookName): boolean {
    return this.hooks.includes(hook);
  }

  async dispatch(hook: HookName, event: HookEvent): Promise<unknown> {
    return await this.host.dispatch(hook, event);
  }

  async stop(): Promise<void> {
    await this.host.stop();
  }
}
