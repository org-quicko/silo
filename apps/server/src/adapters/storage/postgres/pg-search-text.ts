import type { SearchQuery } from "../../../core/search/search-tokens";
import type { PgParams } from "./pg-params";
import type { PgSearchTokenizer } from "./pg-search-tokenizer";

/**
 * A user's search text as SQL over `entry_search d`: the conditions that
 * decide a match, and the expression that ranks one (D30).
 *
 * The rules are `SearchTokens.parseQuery`'s, so every engine agrees on what a
 * query means: every term must be present, and the last one is a prefix unless
 * the text ended on a separator.
 */
export class PgSearchText {
  /** Label weight A, body weight B; the array is `{D, C, B, A}`. 10:1, as bm25 and the scan use. */
  private static readonly Weights = "'{0, 0, 0.1, 1}'";

  /** The longest lexeme a `tsquery` holds; a longer term cannot be in the index. */
  private static readonly MaxTermBytes = 2047;

  /**
   * The conditions and the rank, or null when the query can match nothing —
   * saying so beats scanning every row to prove it. No terms, no conditions:
   * a filter-only search.
   */
  static predicate(
    query: SearchQuery,
    tokenizer: PgSearchTokenizer,
    params: PgParams
  ): { conds: string[]; rank: string | null } | null {
    if (query.terms.length === 0) return { conds: [], rank: null };
    if (query.terms.some((term) => Buffer.byteLength(term, "utf8") > PgSearchText.MaxTermBytes)) {
      return null;
    }
    return tokenizer === "trigram"
      ? PgSearchText.substrings(query, params)
      : PgSearchText.words(query, params);
  }

  /**
   * One `tsquery`, written by hand like the `tsvector` it runs against, so no
   * text-search configuration can read the terms differently. Terms are letters
   * and numbers only, so none needs escaping, and none is an operator: a user
   * typing "not" searches for "not".
   */
  private static words(query: SearchQuery, params: PgParams): { conds: string[]; rank: string } {
    const last = query.terms.length - 1;
    const tsquery = query.terms
      .map((term, index) => `'${term}'${query.prefixLast && index === last ? ":*" : ""}`)
      .join(" & ");
    const bound = `${params.add(tsquery)}::tsquery`;
    return {
      conds: [`d.document @@ ${bound}`],
      rank: `ts_rank_cd(${PgSearchText.Weights}, d.document, ${bound})`,
    };
  }

  /**
   * Every term as a substring of the folded label or body, which `pg_trgm`'s
   * index answers for a term of three characters or more and a scan answers,
   * still correctly, for a shorter one. A prefix is a substring already. The
   * rank is the same 10:1, counted per term.
   */
  private static substrings(query: SearchQuery, params: PgParams): { conds: string[]; rank: string } {
    const conds: string[] = [];
    const ranks: string[] = [];
    for (const term of query.terms) {
      // Letters and numbers only, so `%` and `_` cannot occur in a term.
      const pattern = params.add(`%${term}%`);
      conds.push(`(d.label LIKE ${pattern} OR d.body LIKE ${pattern})`);
      ranks.push(
        `(CASE WHEN d.label LIKE ${pattern} THEN 10 ELSE 0 END + CASE WHEN d.body LIKE ${pattern} THEN 1 ELSE 0 END)`
      );
    }
    return { conds, rank: ranks.join(" + ") };
  }
}
