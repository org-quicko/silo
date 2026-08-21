/** Where a match was found, and enough text to show why it matched. */
export interface SearchSnippet {
  /** The concrete D29 path of the node the match came from. */
  path: string;
  /** Text around the match, with the matched run wrapped in `[` and `]`. */
  text: string;
}
