/**
 * A collection as the listing answers it (D54): what it is, how much it holds,
 * and when it moved — everything a navigation surface draws, and no schema.
 *
 * `Collection` is the shape *with* the schema, fetched per collection when a
 * page actually renders one, or in bulk by `api.collections.schemas`.
 */
export interface CollectionSummary {
  /** The record's ULID (D51). Stable across a rename, unlike `name`. */
  id: string
  name: string
  entries: number
  /** Whether reading it needs a key — the public/private badge, read from the
   *  listing because the schema it used to be derived from is not in it. */
  requires_auth: boolean
  created_at: string
  updated_at: string
}
