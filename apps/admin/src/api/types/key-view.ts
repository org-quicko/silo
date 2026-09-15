/** What `GET /api/keys` returns per key — never the secret. */
export interface KeyView {
  id: string
  label: string
  claims: string[]
  prefix: string
  created_at: string
  /** When the label or the claims last changed (D63). Equal to `created_at`
   *  until someone edits the key. */
  updated_at: string
  /** Present only on a key silo minted for a plugin (D34). Such a key is
   *  refused by the ordinary revoke path, so the UI must not offer it. */
  owner?: { kind: 'plugin'; name: string }
  /** The key that minted this one (D38). Revoking that one takes this with it. */
  parent_id?: string
}
