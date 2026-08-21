import type { SearchField } from "./search-field";
import type { SearchSnippet } from "./search-snippet";
import { SearchTokens, type SearchQuery } from "./search-tokens";

/**
 * Cuts the "why did this match" fragment out of the fields an entry
 * contributed. Snippet text is engine-specific by contract (D30) — FTS5 will
 * produce its own with `snippet()` — so nothing here is a promise the SQLite
 * engine has to reproduce character for character.
 */
export class SearchSnippets {
  static readonly DefaultWindow = 40;
  static readonly DefaultMax = 3;

  static build(
    fields: readonly SearchField[],
    query: SearchQuery,
    max = SearchSnippets.DefaultMax
  ): SearchSnippet[] {
    if (query.terms.length === 0) return [];

    const out: SearchSnippet[] = [];
    // Label fields first: a match in a title explains a result better than the
    // same word buried in a body, and the cap means the order decides what the
    // reader actually sees.
    const ordered = [...fields].sort((a, b) => Number(b.label) - Number(a.label));

    for (const field of ordered) {
      if (out.length >= max) break;
      const snippet = SearchSnippets.cut(field, query);
      if (snippet) out.push(snippet);
    }
    return out;
  }

  private static cut(field: SearchField, query: SearchQuery): SearchSnippet | null {
    const { folded, map } = SearchTokens.foldWithMap(field.text);

    let at = -1;
    let term = "";
    for (const t of query.terms) {
      const i = folded.indexOf(t);
      if (i !== -1 && (at === -1 || i < at)) {
        at = i;
        term = t;
      }
    }
    if (at === -1) return null;

    const start = map[at];
    const end = map[Math.min(at + term.length, folded.length)];
    const from = Math.max(0, start - SearchSnippets.DefaultWindow);
    const to = Math.min(field.text.length, end + SearchSnippets.DefaultWindow);

    const text =
      (from > 0 ? "…" : "") +
      field.text.slice(from, start) +
      "[" +
      field.text.slice(start, end) +
      "]" +
      field.text.slice(end, to) +
      (to < field.text.length ? "…" : "");

    return { path: field.path, text };
  }
}
