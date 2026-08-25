/** What a plugin may call back into. Implemented by `PluginContext`, which
 *  checks every call against the claims the operator granted. */
export interface PluginRpc {
  /**
   * `cause` is the causal chain of the dispatch this call came out of, which
   * the **host** supplies from the dispatch the worker correlated it to — never
   * the plugin, which cannot be trusted to describe its own nesting (D33). An
   * empty chain is a call from outside any dispatch.
   */
  call(method: string, args: readonly unknown[], cause: readonly string[]): Promise<unknown>;
  log(level: string, message: string, fields?: Record<string, unknown>): void;
}
