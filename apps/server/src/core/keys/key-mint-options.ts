import type { AuditActor } from "../audit/audit-actor";
import type { KeyOwner } from "./key-owner";

/**
 * The optional halves of a key's identity (D34, D38).
 *
 * An options object rather than two trailing positional arguments, because both
 * are optional and independent: `create(label, claims, undefined, parentId)` is
 * the call this shape exists to prevent.
 */
export interface KeyMintOptions {
  /** Set when silo mints the key for a plugin and keeps its secret (D34). */
  owner?: KeyOwner;
  /** The `_keys` id of the minting key, when one is minting (D38). */
  parentId?: string;
  /**
   * Who is minting, for the trail (D38).
   *
   * Optional only because `bootstrap` mints before any actor exists; everything
   * else names one. An absent actor is recorded as `system`, which is the honest
   * answer for a key silo minted for itself, and never as an anonymous gap.
   */
  actor?: AuditActor;
}
