/**
 * Who made an authority change (D38).
 *
 * Three kinds, because "nobody" is not an answer an audit log may give and the
 * three genuinely differ in what can be known about them. A `key` actor is
 * identified by its record id, which survives the key being revoked — the whole
 * point of recording the id rather than the secret's prefix.
 *
 * `cli` carries no id on purpose. The offline commands act on the data directory
 * and are bounded by filesystem access, not by a key (`GrantRequest`), so there
 * is nothing to name; inventing a synthetic root actor would hide which of the
 * two paths ran, which is exactly what the log exists to disambiguate.
 */
export interface AuditActor {
  kind: "key" | "cli" | "system";
  /** The `_keys` record id, for `kind: "key"` only. */
  id?: string;
  /** The key's label at the time, denormalized so a revoked key's entries stay
   *  readable. A log that renders as bare ids after a cleanup is not one anyone
   *  will use. */
  label?: string;
}
