import type { KeyOwner } from "../../keys/key-owner";

export interface KeyView {
  id: string;
  label: string;
  claims: string[];
  prefix: string;
  created_at: string;
  /** Present only on a key silo minted for a plugin (D34), so a listing can
   *  say why this one is not an operator's to revoke. */
  owner?: KeyOwner;
}
