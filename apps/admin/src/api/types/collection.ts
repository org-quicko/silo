export interface Collection {
  /** The record's ULID (D51). Stable across a rename, unlike `name`. */
  id: string
  name: string
  schema: any
}
