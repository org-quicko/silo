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
  /** A plugin was enabled or disabled for the next load. */
  | "plugin.enable"
  | "plugin.disable";
