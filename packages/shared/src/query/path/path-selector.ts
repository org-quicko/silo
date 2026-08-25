/**
 * One selector in a parsed {@link JsonPath} — the RFC 9535 subset silo accepts
 * (D29): a name, an array index, or the wildcard.
 *
 * Recursive descent, slices, index unions, filter selectors, function
 * extensions and script expressions are outside the subset. The parser refuses
 * them by name rather than dropping them, because a silently ignored selector
 * produces a *wrong answer* that no test using well-formed paths would catch.
 */
export type PathSelector =
  | { kind: "name"; name: string }
  /** May be negative; RFC 9535 counts a negative index from the end. */
  | { kind: "index"; index: number }
  /** `[*]` and `.*` are the same selector: every child of an array or object. */
  | { kind: "wildcard" };
