/** Where a match was found, split into three plain strings rather than one
 *  with markers in it: the fragment is `before + match + after`. */
export interface SearchSnippet {
  readonly path: string;
  readonly before: string;
  readonly match: string;
  readonly after: string;
}
