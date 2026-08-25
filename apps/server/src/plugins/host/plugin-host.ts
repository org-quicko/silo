import type { HookName, HookEvent } from "../../core/hooks";

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

  stop(): Promise<void>;
}
