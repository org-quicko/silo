/**
 * The derived state a write carries alongside the entry itself (D23, D30).
 *
 * Both halves are computed by the **caller** and land inside the adapter's own
 * write transaction, which is the only place they can be atomic with it: a
 * decorator above the port can intercept `put`, but it cannot be atomic with
 * `deleteProject`'s bulk SQL delete, so entries would vanish while their
 * derived rows survived.
 *
 * Neither field is optional, for the reason D23 gives about usages and which
 * applies identically to search text: an omitted value has no safe reading —
 * "clear it" silently orphans a live reference or drops an entry out of
 * search, "leave it" silently rots the index — so a caller who forgets gets a
 * type error rather than a bug.
 */
export interface DerivedIndex {
  /** The entry's complete set of media reference tokens (`MediaRefs.extract`). */
  usages: string[];

  /**
   * The entry's searchable text, or `null` to index nothing.
   *
   * `null` is what system data passes (`_keys`, `_media`): a key label must
   * never become findable by text. Adapters guard the system scope themselves
   * as well, so one forgotten `null` at a call site cannot expose one.
   */
  search: { label: string; body: string } | null;
}
