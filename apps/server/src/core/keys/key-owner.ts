/**
 * Who a key belongs to, when it is not a person (D34).
 *
 * Absent on an ordinary key, which is what "someone minted this and holds the
 * secret" looks like. Present on a **managed** key, which silo minted for a
 * plugin and whose secret silo keeps: the plugin never receives it, and it
 * rotates on every start.
 *
 * It is a field on the key rather than a separate collection because the
 * question it answers — "may an operator revoke this by hand?" — is asked at
 * exactly the moments a key record is already loaded, and a join there would be
 * a second lookup that could be forgotten.
 */
export interface KeyOwner {
  kind: "plugin";
  /** The `[[plugins]] name` this key was minted for. */
  name: string;
}
