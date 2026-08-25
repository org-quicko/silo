/**
 * Who is changing a plugin's grant (D34).
 *
 * `claims` absent means **the CLI acting on the data directory**, which holds
 * no key and is bounded by filesystem access instead — the same authority
 * `silo keys create` already has offline. It is not "skip the check": the
 * delegation rule only has meaning when there is a granter to compare against,
 * and inventing a synthetic root one would hide which of the two paths ran.
 */
export interface GrantRequest {
  /** The granting key's claims, or `undefined` for the offline CLI. */
  claims?: readonly string[];
  /** The granting key's id, recorded on the grant. `null`/absent offline. */
  keyId?: string | null;
}
