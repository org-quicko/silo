import type { AuditAction } from "./audit-action";
import type { AuditActor } from "./audit-actor";

/**
 * One recorded authority change (D38).
 *
 * Stored as an ordinary document in the reserved `_audit` collection of
 * `Scope.System` — the trick D12 used for `_keys`, D23 for `_media` and D34 for
 * `_plugins`, so it gets every adapter and query for free, and is excluded from
 * archives and the entries API by the same rules that already hide those.
 *
 * **Append-only by construction**, not by permission: nothing in
 * `AuditService` updates or deletes, and `_audit` is unreachable through the
 * entries API because `Scope.of` refuses a `_`-prefixed id (D37). That is the
 * honest limit — anyone with filesystem access can edit the database, and no
 * in-process log can claim otherwise.
 */
export interface AuditEvent {
  /** ISO 8601, denormalized from the envelope so a caller reading `data` alone
   *  has the whole event. */
  at: string;
  action: AuditAction;
  actor: AuditActor;
  /** What was changed: a `_keys` id for `key.*`, a plugin name for `plugin.*`.
   *  Deliberately one field rather than a per-action shape, so the log can be
   *  filtered by subject without knowing the action. */
  subject: string;
  /**
   * Everything action-specific, and nothing that would make the log a
   * credential store.
   *
   * Never a secret and never a hash: the log records that a key with these
   * claims was minted, not anything that could authenticate as it. Claims
   * themselves are in — an audit trail that says "the grant changed" without
   * saying to what is a notification, not a record.
   */
  detail: Record<string, unknown>;
}
