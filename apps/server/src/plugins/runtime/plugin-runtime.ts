import { Claims } from "@silo/shared/claims";
import type { HookName } from "../../core/hooks";
import type { HookEvent } from "../../core/hooks";
import type { PluginConfig } from "../../config/plugin-config";
import type { PluginHost } from "../host";
import type { PluginServeRequest } from "../host/plugin-serve-request";
import type { PluginServeResponse } from "../host/plugin-serve-response";
import type { ResolvedPlugin } from "../manifest";
import { PluginRouteTable } from "./plugin-route-table";
import type { PluginAuthority } from "../registry/plugin-authority";
import type { PluginStatus } from "../registry/plugin-status";
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

  /**
   * The config document the worker was actually initialised with (D39).
   *
   * `config.config` is what `silo.toml` declares; this is what won — the stored
   * override when `PATCH .../config` set one. Kept because config crosses to the
   * worker exactly once, at `init`, so "is this plugin already running the
   * config it should be?" is a question only the value it started with can
   * answer, and a rescan that could not ask it would restart every plugin every
   * time.
   */
  readonly runtimeConfig: Record<string, unknown>;

  /**
   * What the operator granted, in the cell `PluginContext` reads too (D34, D39).
   *
   * A cell rather than a value because phase 4 revokes without a restart, and
   * the two readers of a grant — hook delivery here, the injected principal
   * there — must never disagree about it for even one dispatch. A plugin
   * awaiting approval holds an empty claim list, which is why `pending` needs no
   * code path of its own: every check already refuses it.
   */
  private readonly cell: PluginAuthority;

  private readonly host: PluginHost;

  private readonly table: PluginRouteTable;

  constructor(
    plugin: ResolvedPlugin,
    config: PluginConfig,
    host: PluginHost,
    hooks: readonly HookName[],
    authority: PluginAuthority,
    runtimeConfig: Record<string, unknown>
  ) {
    this.plugin = plugin;
    this.config = config;
    this.name = config.name;
    this.host = host;
    this.hooks = hooks;
    this.cell = authority;
    this.runtimeConfig = runtimeConfig;
    this.table = new PluginRouteTable(plugin.manifest.contributes.routes);
  }

  /** Read afresh at every call site. Destructuring this once into a local is
   *  how a live revocation stops being live. */
  get authority(): ResolvedGrant {
    return this.cell.current();
  }

  /** Swap what this plugin may do, with no restart and no torn state (D39). */
  useAuthority(grant: ResolvedGrant): void {
    this.cell.set(grant);
  }

  handles(hook: HookName): boolean {
    return this.hooks.includes(hook);
  }

  /** What this plugin declared it serves. Built once — the manifest cannot
   *  change without a restart, because it is read from disk before the worker
   *  starts. */
  get routes(): PluginRouteTable {
    return this.table;
  }

  /**
   * Whether this plugin may serve its routes **right now** (D36, phase 6).
   *
   * Read through `authority` at every call, like `mayReceive`, so revoking
   * `http:route` closes the routes on the next request with no restart — the
   * same property phase 4 established for hook delivery and `ctx`. A plugin
   * that declares routes and holds no grant is reachable in exactly the way it
   * is dispatched to: not at all.
   */
  mayServe(): boolean {
    return Claims.has(this.authority.claims, Claims.HttpRoute);
  }

  async serve(key: string, request: PluginServeRequest): Promise<PluginServeResponse> {
    return await this.host.serve(key, request);
  }

  /** Run the plugin's `activate(ctx)`, if it declared one (D36). Idempotent in
   *  the host, so the boot pass and a live `enable` may both ask. */
  async activate(): Promise<void> {
    await this.host.activate();
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

  /** Running, or dead and why (D39). A worker that missed its budget is torn
   *  down and never respawned, so "loaded" and "working" are different
   *  questions and a management surface has to be able to ask the second. */
  status(): PluginStatus {
    const failure = this.host.failure();
    return {
      state: failure ? "failed" : "running",
      hooks: [...this.hooks],
      detail: failure ? failure.message : null,
    };
  }

  async dispatch(hook: HookName, event: HookEvent): Promise<unknown> {
    return await this.host.dispatch(hook, event);
  }

  async stop(): Promise<void> {
    await this.host.stop();
  }
}
