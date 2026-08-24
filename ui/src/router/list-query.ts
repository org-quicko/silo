/** What the entries view is showing, all of it linkable (D29/D30). */
export interface ListQuery {
  /** Free text. Since P3 this runs the collection `/search` route. */
  q: string
  /**
   * An RFC 9535 path (D29) the reader chose, or `null` for the view's default.
   * The difference has to survive the URL: §5.5 gives a supplied `sort`
   * precedence over relevance, so "by date because nobody chose" and "by date
   * because someone did" cannot be the same value — the first must become
   * relevance order the moment a search is typed, and the second must not.
   */
  sort: string | null
  desc: boolean
  page: number
  /**
   * The Query AST as it travels: raw JSON text, not a parsed object. A
   * hand-edited link therefore reaches the view intact and is reported, rather
   * than being dropped in the router — dropping a filter *widens* what is on
   * screen, which is the one direction a failure must never take.
   */
  filter: string | null
  /** Comma-separated extra column names, or `null` for the derived default (handoff 1e). */
  cols: string | null
}

export const DEFAULT_LIST_QUERY: ListQuery = { q: '', sort: null, desc: true, page: 1, filter: null, cols: null }
