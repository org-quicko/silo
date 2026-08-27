/**
 * The hooks a plugin may register (D31/§13.5, extended by D36).
 *
 * Five entry hooks, not ten: each carries an `op` rather than splitting into
 * create and update variants, because doubling the set would double what 1.0
 * freezes for no expressive gain.
 *
 * The sixth is **collection-level**, and it is the one erasure a plugin could
 * not otherwise see (D37's F6). A forced collection, environment or project
 * delete removes every entry underneath it without dispatching a single
 * `entry.afterDelete`, so an auditing or mirroring plugin watched entries appear
 * and never saw them go. One event per erased entry was the alternative and is
 * worse: a 100k-row delete would become a 100k-event fan-out through the D33
 * chain, for a fact that is one sentence long.
 *
 * They are **domain lifecycle** events, not HTTP middleware. See `Hooks` in
 * `apps/server/src/core/hooks/` for which write paths dispatch them and which
 * deliberately do not.
 *
 * It lives in `shared` rather than in the server because D34 makes hook
 * *delivery* a claim — `hooks:<project>/<env>/<collection>:<hook>` — so the
 * claim grammar has to validate the last segment against this list, and the
 * admin UI has to render it. One vocabulary, one place.
 */
export type HookName =
  /** May replace `data`. Runs **before** validation, so the schema still judges
   *  exactly the value that will be stored (§5.1, D23). */
  | "entry.beforeValidate"
  /** May reject, may not mutate: the envelope is built and the data validated
   *  by this point, so a rewrite here would store what the schema never saw. */
  | "entry.beforeWrite"
  /** Observe only. Fires after the write commits, outside the write mutex. */
  | "entry.afterWrite"
  | "entry.beforeDelete"
  | "entry.afterDelete"
  /**
   * Observe only. Fires once per collection erased, after the delete commits and
   * after the write lock is released, carrying how many entries went with it.
   *
   * There is deliberately no `collection.beforeDelete` to match. A veto there
   * would be a plugin overruling an explicit `?force=true` from a caller that
   * already had to hold `entries:delete` at the reach it was erasing (D37's F1),
   * and a project delete erases many collections under one lock — so a refusal
   * halfway through would leave the project half-erased, which is precisely what
   * `ScopeService` plans the whole delete up front to avoid.
   */
  | "collection.afterDelete";
