/** A parsed user query: terms that must all be present, last one as a prefix. */
export interface SearchQuery {
  terms: string[];
  /** False when the user's text ended on a separator, so nothing is partial. */
  prefixLast: boolean;
}

/**
 * The tokenizer both engines answer to (D30).
 *
 * These five rules are a deliberate imitation of SQLite's
 * `unicode61 remove_diacritics 2`, measured rather than assumed:
 *
 * | input                        | terms                          |
 * |------------------------------|--------------------------------|
 * | `foo_bar baz`                | `foo` `bar` `baz`              |
 * | `01J8XQ4Z8K9M2P3R5T7V9X1B3D` | one term, lowercased           |
 * | `https://silo.dev/a/b?x=1`   | `https` `silo` `dev` `a` `b` `x` `1` |
 * | `Café CRÈME`                 | `cafe` `creme`                 |
 * | `don't`, `e-mail`            | `don` `t`, `e` `mail`          |
 * | `日本語のテキスト`             | **one** term                   |
 *
 * Exact parity across all of Unicode is not achievable — SQLite's character
 * tables and the JavaScript engine's are different versions of different
 * data. So the contract is parity **on fixtures**, and the conformance suite
 * owns the fixtures. That last row is not a curiosity: `unicode61` does not
 * segment CJK, so those deployments must select the `trigram` tokenizer.
 */
export class SearchTokens {
  /** Anything that is not a Unicode letter or number separates tokens. */
  private static readonly separators = /[^\p{L}\p{N}]+/u;
  private static readonly combiningMarks = /\p{M}/gu;

  /** Lowercase and strip diacritics, leaving the token comparable. */
  static fold(s: string): string {
    return s.normalize("NFD").replace(SearchTokens.combiningMarks, "").toLowerCase();
  }

  /**
   * Folds while keeping a folded-index -> original-index map, so a snippet can
   * quote the *original* text ("Café") after matching the folded one ("cafe").
   * Folding whole-string loses that alignment, because stripping a combining
   * mark shortens the string.
   */
  static foldWithMap(text: string): { folded: string; map: number[] } {
    let folded = "";
    const map: number[] = [];
    let i = 0;
    for (const ch of text) {
      const f = ch.normalize("NFD").replace(SearchTokens.combiningMarks, "").toLowerCase();
      for (let k = 0; k < f.length; k++) map.push(i);
      folded += f;
      i += ch.length;
    }
    map.push(text.length);
    return { folded, map };
  }

  static tokenize(text: string): string[] {
    if (!text) return [];
    return SearchTokens.fold(text).split(SearchTokens.separators).filter((t) => t.length > 0);
  }

  /**
   * A user's text becomes an all-terms-required query whose final term is a
   * prefix, which is what makes a search box feel like type-ahead. A text
   * ending in a separator is treated as complete — the user finished the word.
   */
  static parseQuery(text: string): SearchQuery {
    const terms = SearchTokens.tokenize(text);
    const folded = SearchTokens.fold(text);
    const endsOnSeparator = folded.length > 0 && SearchTokens.separators.test(folded.slice(-1));
    return { terms, prefixLast: terms.length > 0 && !endsOnSeparator };
  }

  /** How many of `query`'s terms this token set carries. */
  static matchCount(tokens: Set<string>, query: SearchQuery): number {
    let found = 0;
    for (let i = 0; i < query.terms.length; i++) {
      const term = query.terms[i];
      const isPrefix = query.prefixLast && i === query.terms.length - 1;
      if (SearchTokens.hasTerm(tokens, term, isPrefix)) found++;
    }
    return found;
  }

  /** Every term present — the AND that makes a multi-word search narrow. */
  static matchesAll(tokens: Set<string>, query: SearchQuery): boolean {
    return query.terms.length > 0 && SearchTokens.matchCount(tokens, query) === query.terms.length;
  }

  private static hasTerm(tokens: Set<string>, term: string, isPrefix: boolean): boolean {
    if (tokens.has(term)) return true;
    if (!isPrefix) return false;
    for (const t of tokens) {
      if (t.startsWith(term)) return true;
    }
    return false;
  }
}
