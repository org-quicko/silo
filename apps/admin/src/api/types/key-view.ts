/** What `GET /api/keys` returns per key — never the secret. */
export interface KeyView {
  id: string
  label: string
  claims: string[]
  prefix: string
  created_at: string
  /** Present only on a key silo minted for a plugin (D34). Such a key is
   *  refused by the ordinary revoke path, so the UI must not offer it. */
  owner?: { kind: 'plugin'; name: string }
}
