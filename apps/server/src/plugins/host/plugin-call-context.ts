/**
 * What the **host** knows about the dispatch a plugin callback came out of
 * (D33, D35).
 *
 * Both fields are read from the host's own record of that dispatch and never
 * from the worker's message. A plugin that could describe its own nesting could
 * hand itself an empty chain and escape the cycle skip; a plugin that could
 * name its own budget could hand itself an unbounded one.
 */
export interface PluginCallContext {
  /**
   * The plugins whose hooks are on the stack above this call, in order (D33).
   * Empty for a call made outside any dispatch — a timer, or a future
   * `activate()` — which is genuinely uncaused.
   */
  cause: readonly string[];

  /**
   * What is left of the dispatch's budget, in milliseconds.
   *
   * A `ctx.fetch` is bounded by the time its own dispatch has left rather than
   * by a budget of its own, so a call that runs long **rejects and names
   * itself** a moment before `WorkerHost` would kill the worker for the
   * dispatch running long. That kill is still not undone automatically — since
   * phase 4 it is reported and an operator can restart (D39) — so the
   * difference is between a plugin that can catch a slow call and a plugin that
   * needs somebody to notice (D37, phase 3's fourth requirement).
   *
   * The full `timeout_ms` for a call outside any dispatch, which has no
   * deadline over it and would otherwise have none at all.
   */
  budgetMs: number;
}
