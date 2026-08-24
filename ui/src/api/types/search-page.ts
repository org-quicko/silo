import type { SearchHit } from './search-hit'

export interface SearchPage {
  items: SearchHit[]
  total: number
  limit: number
  offset: number
  /**
   * The portable engine stops at a visit cap and a time budget; when it does,
   * `total` counts what it examined rather than what exists. Shown to the
   * reader instead of being swallowed, because a count that quietly means
   * something else is worse than a slow search.
   */
  truncated: boolean
  /** `fts5` for an indexed answer, `scan` for a walked one. */
  engine: 'fts5' | 'scan'
}
