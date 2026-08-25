import type { KeyOwner } from "./key-owner";

export interface KeyInfo {
  label: string;
  claims: string[];
  hash: string;
  prefix: string;
  /** Set only on a key silo minted for a plugin (D34). Its absence is what
   *  makes a key an ordinary one, so nothing has to be backfilled. */
  owner?: KeyOwner;
}
