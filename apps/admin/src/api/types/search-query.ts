import type { Filter } from '@silo/shared/filter'

/** What to search for. Everything is optional: a filter-only search is valid. */
export interface SearchQuery {
  /** The user's text. Travels as `?q=`, the name §5.5 gives it. */
  query?: string
  filter?: Filter | null
  /** A `sort` string such as `-$.updated_at`. Supplying one beats relevance. */
  sort?: string
  limit?: number
  offset?: number
}
