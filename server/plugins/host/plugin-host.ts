import type { HookName, HookEvent } from "../../core/hooks";

/**
 * How a plugin's code is executed (D31/§13.4).
 *
 * A port with exactly one adapter, `WorkerHost`, and deliberately no second
 * one. An inline host was written and then removed (D7): nothing selected it.
 * Providers are *constructed*, not dispatched, so they never reach this port at
 * all — see `PluginLoader.loadProviders` — and the hook tests run through the
 * worker on purpose, because an inline load would pass a plugin whose worker
 * cannot start and would skip the structured-clone boundary every payload
 * really crosses. A host whose `timeout_ms` is merely advisory sitting next to
 * one where it is enforced is a trap, not an option.
 *
 * It stays a port rather than collapsing into `WorkerHost` for the reason
 * below: what is worth naming here is the *contract*, not the count of things
 * implementing it.
 *
 * The method set is deliberately small and **fully serializable**: `dispatch`
 * takes plain JSON and returns plain JSON. That is what lets one contract span
 * an in-process call and a structured-clone boundary today, and a WASM or
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

  stop(): Promise<void>;
}
