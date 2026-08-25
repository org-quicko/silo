/**
 * Where a configured plugin stands with the operator (D34).
 *
 * A state rather than a boolean because three of the four are distinguishable
 * only by *why* a plugin is not running, and an operator staring at a plugin
 * that does nothing needs that answer more than they need the fact.
 */
export type PluginGrantState =
  /** Installed and listed in `silo.toml`, never approved. It loads, is never
   *  dispatched, and every `ctx` call is refused. Deliberately **not** a
   *  refused start: granting needs a running server to grant through, so a
   *  server that would not boot could never be granted one. */
  | "pending"
  /** Approved and running on the claims the record names. */
  | "granted"
  /** Approved once, and the package has since asked for **more**. It keeps
   *  running on the grant it had; the new claims are not granted and an
   *  operator has to look. This is the state that makes "an upgrade never
   *  escalates" a mechanism rather than a promise. */
  | "needs_review"
  /** Approved and then withdrawn. Distinct from `pending` because it is a
   *  decision rather than an absence: re-granting should not look like a first
   *  approval, and the record keeps who withdrew it and when. */
  | "revoked";
