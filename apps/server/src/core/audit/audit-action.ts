/**
 * The authority changes silo records (D38).
 *
 * A closed union rather than a free string, for the reason every other
 * vocabulary in this codebase is closed: a log nobody can query by action is a
 * log nobody reads, and an open string guarantees that two call sites will spell
 * the same event differently. Adding a member here is the deliberate act of
 * saying a new kind of decision exists.
 *
 * Only **authority** changes are in scope. Entry writes are not audited — that
 * is what `rev`, `updated_at` and the hook stream already are, and duplicating
 * content history here would turn a log about decisions into a log about
 * traffic, which is the thing that makes an audit log too big to read.
 */
export type AuditAction =
  /** A key was minted. `detail.claims` is what it was given. */
  | "key.create"
  /** A key was revoked. `detail.cascaded` names the descendants that went with
   *  it, which is the one part of the outcome the 204 cannot carry. */
  | "key.revoke"
  /** A plugin's grant was approved or narrowed. */
  | "plugin.grant"
  /** A plugin's stored grant was withdrawn. */
  | "plugin.revoke"
  /**
   * A plugin's record was destroyed, package and all (D43).
   *
   * Distinct from `plugin.revoke`, which leaves a plugin listed, installed and
   * approved for nothing. This is the end of the record, so it is the last
   * entry the trail will ever hold about that name — and the trail outlives it,
   * which is the point: `detail.withdrawn` is what the plugin could do at the
   * moment it was taken away, and nothing else records that once the record is
   * gone.
   */
  | "plugin.uninstall"
  /** A plugin was started or stopped. Since phase 4 that happens immediately
   *  rather than at the next load (D39). */
  | "plugin.enable"
  | "plugin.disable"
  /**
   * A plugin's stored config override was set or cleared (D39).
   *
   * An authority change, narrowly but genuinely: config decides what a plugin
   * *does* with the claims it holds — which endpoint it calls, which collection
   * it mirrors — so an operator asking "why did this plugin start writing
   * there?" is asking a question only this answers. `detail.cleared` says which
   * of the two it was, because reverting to `silo.toml` and pinning an override
   * look identical in a diff of the record.
   */
  | "plugin.configure";
