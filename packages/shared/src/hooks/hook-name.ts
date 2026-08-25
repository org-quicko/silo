/**
 * The hooks a plugin may register (D31/§13.5).
 *
 * Five, not ten: each carries an `op` rather than splitting into create and
 * update variants, because doubling the set would double what 1.0 freezes for
 * no expressive gain.
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
  | "entry.afterDelete";
