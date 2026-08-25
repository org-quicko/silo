import type { KeyOwner } from "./key-owner";

export interface KeyInfo {
  label: string;
  claims: string[];
  hash: string;
  prefix: string;
  /** Set only on a key silo minted for a plugin (D34). Its absence is what
   *  makes a key an ordinary one, so nothing has to be backfilled. */
  owner?: KeyOwner;
  /**
   * The `_keys` id of the key that minted this one (D38).
   *
   * Absent on a key minted offline by the CLI, on the bootstrap root, and on a
   * plugin's managed key — none of those has a parent, and absence is what makes
   * a pre-D38 record valid without backfilling. Revoking a key revokes
   * everything that names it here, transitively: D37 found that a minted key
   * otherwise outlives the authority that produced it.
   */
  parent_id?: string;
}
