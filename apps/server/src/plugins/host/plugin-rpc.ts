import type { PluginCallContext } from "./plugin-call-context";

/** What a plugin may call back into. Implemented by `PluginContext`, which
 *  since D35 dispatches every call through the HTTP surface rather than
 *  checking claims itself. */
export interface PluginRpc {
  /**
   * `dispatch` describes the hook dispatch this call came out of — its causal
   * chain and what is left of its budget — and the **host** supplies both from
   * its own record of that dispatch, never the worker, which cannot be trusted
   * to describe its own nesting or its own deadline (D33, D35).
   */
  call(method: string, args: readonly unknown[], dispatch: PluginCallContext): Promise<unknown>;
  log(level: string, message: string, fields?: Record<string, unknown>): void;
}
