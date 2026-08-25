import type { AuditActor } from "../../audit/audit-actor";

/**
 * Who is changing a plugin's grant, and against which revision (D34, D38).
 *
 * `claims` absent means **the CLI acting on the data directory**, which holds
 * no key and is bounded by filesystem access instead — the same authority
 * `silo keys create` already has offline. It is not "skip the check": the
 * delegation rule only has meaning when there is a granter to compare against,
 * and inventing a synthetic root one would hide which of the two paths ran.
 *
 * `actor` is **required**, which is the point of it replacing D34's `keyId`.
 * Two overlapping fields would have let a call site record who changed a grant
 * and forget to say who, and the one thing an audit trail may never contain is
 * an anonymous entry. `granted_by` is derived from it rather than passed
 * beside it.
 */
export interface GrantRequest {
  /** The granting key's claims, or `undefined` for the offline CLI. */
  claims?: readonly string[];
  /** Who is making the change. `AuditUtils.key(...)` or `AuditUtils.cli()`. */
  actor: AuditActor;
  /**
   * The revision the caller believes it is changing, from `If-Match`.
   *
   * Absent for the offline CLI, which is the only caller with no earlier read to
   * be stale against. Present it and a grant means "approve **what I read**" —
   * without it, a package that changed between the operator reading its request
   * and approving it would be approved on the strength of the older one, which
   * is the exact substitution `needs_review` exists to prevent.
   */
  expectedRev?: number;
}
