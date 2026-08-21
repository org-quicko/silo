/**
 * Why a hit matched, in three plain strings: the fragment is
 * `before + match + after`, and `match` is the run to highlight.
 *
 * The server hands the parts over separately rather than marking up one string
 * (D30/§5.5) — content that contains a bracket of its own would otherwise give
 * a highlighter two candidates and no way to choose.
 */
export interface SearchSnippet {
  /** The concrete D29 path the match came from, e.g. `$.data.blocks[0].text`. */
  path: string
  before: string
  match: string
  after: string
}
