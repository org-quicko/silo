import type { Entry } from './entry'
import type { SearchSnippet } from './search-snippet'

/**
 * One search result. The location sits on the hit and never on the entry
 * (§5.1, and the exception D30 records), which is exactly what lets the UI
 * build a link to a result found outside the scope on screen.
 */
export interface SearchHit {
  project: string
  env: string
  collection: string
  entry: Entry
  snippets: SearchSnippet[]
}
