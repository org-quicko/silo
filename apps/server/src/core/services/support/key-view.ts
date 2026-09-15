import type { KeyOwner } from "../../keys/key-owner";

export interface KeyView {
  id: string;
  label: string;
  claims: string[];
  prefix: string;
  created_at: string;
  /** When the record last moved (D63). Equal to `created_at` until someone
   *  edits the label or the claims, which is the only thing that moves it. */
  updated_at: string;
  /** Present only on a key silo minted for a plugin (D34), so a listing can
   *  say why this one is not an operator's to revoke. */
  owner?: KeyOwner;
  /** The key that minted this one (D38). Present so a caller can see what a
   *  revocation would take with it, before asking for one. */
  parent_id?: string;
}
