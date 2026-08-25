import type { HookName, HookEvent } from "../../core/hooks";
import type { PluginServeRequest } from "./plugin-serve-request";
import type { PluginServeResponse } from "./plugin-serve-response";

/**
 * How a plugin's code is executed (D31/§13.4).
 *
 * A port with exactly one adapter, `WorkerHost`, and deliberately no second
 * one — an inline host was written and removed, because a host whose
 * `timeout_ms` is merely advisory sitting beside one where it is enforced is a
 * trap, not an option. Providers are *constructed*, not dispatched, so they
 * never reach this port at all.
 *
 * The method set is small and **fully serializable**: `dispatch` takes plain
 * JSON and returns plain JSON. That is what lets one contract span an
 * in-process call and a structured-clone boundary today, and a WASM or
 * subprocess boundary later, without a plugin's source changing.
 */
export interface PluginHost {
  /**
   * Import the plugin and report which of its declared hooks it exports.
   * Throwing here refuses the start — a plugin that cannot load must not leave
   * an instance running that merely *looks* healthy.
   */
  start(): Promise<readonly HookName[]>;

  /** Run one hook. Rejects with a rehydrated error on a plugin throw, and with
   *  `PluginTimeoutError` when the dispatch outlives its budget. */
  dispatch(hook: HookName, event: HookEvent): Promise<unknown>;

  /**
   * Serve one declared route (D36, phase 6).
   *
   * A second dispatch kind rather than a hook with a request in it, because the
   * two differ in the one way that matters to this port: a hook's *return* is
   * advice the host may ignore, and a route's return **is** the answer. Bounded
   * by the same `timeout_ms`, and a plugin throw arrives rehydrated exactly as
   * `dispatch`'s does, so `ExtRoutes` can map a `ValidationError` to a 400
   * without the worker having to know about status codes.
   */
  serve(key: string, request: PluginServeRequest): Promise<PluginServeResponse>;

  /**
   * Why this host will not run again, or `null` while it will (D39, phase 4).
   *
   * A worker that missed its budget or crashed is torn down and deliberately
   * **not** respawned (§13.9) — a plugin that blew its deadline is usually still
   * spinning, so a respawn walks into the same wall while hiding that anything
   * happened. What phase 4 changes is that the tear-down stops being *silent*:
   * the supervisor reports it, and `POST /api/plugins/{name}/restart` is the
   * deliberate act that brings one back.
   */
  failure(): Error | null;

  stop(): Promise<void>;
}
