/**
 * A project or environment as the API answers it (D51).
 *
 * `id` is the record's ULID and never changes; `name` is a mutable label and is
 * what every path addresses, so a URL is built from `name` and a mutation is
 * bound to `id`.
 */
export interface ScopeRecord {
  id: string
  name: string
}

/** What a rename did, or would do. */
export interface RenameResult {
  id: string
  from: string
  to: string
  /** Claims rewritten to follow the rename. */
  rewritten_claims: string[]
  /**
   * Claims whose reach changed although nothing rewrote them, because they name
   * the subject through a wildcard ancestor. Shown to the operator before they
   * confirm, since nothing else records it.
   */
  pattern_affected_claims: string[]
}
