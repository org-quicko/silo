import { Claims } from "@silo/shared/claims";
import type { HookName } from "../../core/hooks";
import type { HookEvent } from "../../core/hooks";
import type { PluginConfig } from "../../config/plugin-config";
import type { PluginHost } from "../host";
import type { ResolvedPlugin } from "../manifest";
import type { ResolvedGrant } from "../registry/resolved-grant";

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

  /** What the operator granted, and where it stands (D34). A plugin awaiting
   *  approval holds an empty claim list, which is why `pending` needs no code
   *  path of its own — every check already refuses it. */
  readonly authority: ResolvedGrant;

  private readonly host: PluginHost;

  constructor(
    plugin: ResolvedPlugin,
    config: PluginConfig,
    host: PluginHost,
    hooks: readonly HookName[],
    authority: ResolvedGrant
  ) {
    this.plugin = plugin;
    this.config = config;
    this.name = config.name;
    this.host = host;
    this.hooks = hooks;
    this.authority = authority;
  }

  handles(hook: HookName): boolean {
    return this.hooks.includes(hook);
  }

  /**
   * Whether this plugin may be **told** about `hook` for one collection (D34).
   *
   * Delivery is its own authority and not implied by any `entries:*`
   * permission: a plugin handed `entry.beforeValidate` rewrites what is about
   * to be stored, which no collection permission grants. Before D34 this was
   * not checked at all, so a plugin granted nothing saw every write in the
   * instance.
   */
  mayReceive(hook: HookName, project: string, env: string, collection: string): boolean {
    return Claims.canDeliver(this.authority.claims, project, env, collection, hook);
  }

  async dispatch(hook: HookName, event: HookEvent): Promise<unknown> {
    return await this.host.dispatch(hook, event);
  }

  async stop(): Promise<void> {
    await this.host.stop();
  }
}
