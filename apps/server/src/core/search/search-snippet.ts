/**
 * Where a match was found, and enough text to show why it matched — split
 * into three plain strings rather than one string with markers in it.
 *
 * The fragment is `before + match + after`. An earlier shape wrapped the
 * matched run in `[` and `]` inside a single `text`, which reads well in a
 * terminal and is ambiguous everywhere else: a body containing a literal
 * bracket — a markdown link, a footnote — gives a highlighter two candidate
 * pairs and no way to tell which one the engine meant. Escaping would have
 * made every consumer learn an escape rule; offsets would have made them agree
 * on what a character is. Three strings need neither.
 */
export interface SearchSnippet {
  /** The concrete D29 path of the node the match came from. */
  path: string;
  /** Text before the match. Starts with `…` when the fragment was cut. */
  before: string;
  /** The matched run, quoted from the original text — accents and all. */
  match: string;
  /** Text after the match. Ends with `…` when the fragment was cut. */
  after: string;
}
