import { SearchTokens } from "../../../core/search/search-tokens";
import type { PgSearchTokenizer } from "./pg-search-tokenizer";

/** One entry's row in `entry_search`, as its three columns' values. */
export interface PgSearchRow {
  /** A `tsvector` literal, under `unicode61`. */
  document: string | null;
  /** The folded label and body, under `trigram`. */
  label: string | null;
  body: string | null;
}

/**
 * What the Postgres engine stores for an entry's search text.
 *
 * Under `unicode61` the `tsvector` is **written by hand** from
 * `SearchTokens.tokenize` rather than by `to_tsvector`, so the terms in the
 * index are exactly the terms `ScanSearcher` and the query side see: folded,
 * split on anything that is not a letter or a number, never stemmed. Postgres's
 * own parser would read a URL, an e-mail address or a hyphenated word as one
 * token and stem nothing only with the right configuration — a second tokenizer
 * to keep in step. The label's terms carry weight A and the body's weight B,
 * which the ranking reads as 10:1 (docs/design/storage.md §6.6).
 *
 * Under `trigram` the folded text itself is stored, for `pg_trgm` to index.
 */
export class PgSearchDocument {
  /** Postgres's own limits: a lexeme is at most 2047 bytes, and a position at most 16383. */
  private static readonly MaxLexemeBytes = 2047;
  private static readonly MaxPosition = 16383;
  /** A `tsvector` is at most 1 MB; staying well under it keeps a long entry writable. */
  private static readonly MaxLiteralLength = 900_000;

  static of(text: { label: string; body: string }, tokenizer: PgSearchTokenizer): PgSearchRow {
    if (tokenizer === "trigram") {
      return {
        document: null,
        label: SearchTokens.fold(text.label),
        body: SearchTokens.fold(text.body),
      };
    }
    return { document: PgSearchDocument.vector(text.label, text.body), label: null, body: null };
  }

  /**
   * `'term':1A,4B 'other':2A` — every term once, with its positions.
   *
   * Terms are letters and numbers only, so none needs escaping inside the
   * quotes. A term too long for a lexeme is left out, as it could never be
   * typed into a search anyway, and past the position or size limit the rest of
   * the text is left out rather than the whole write refused.
   */
  static vector(label: string, body: string): string {
    const positions = new Map<string, string[]>();
    let position = 0;
    let length = 0;

    const add = (text: string, weight: "A" | "B"): void => {
      for (const term of SearchTokens.tokenize(text)) {
        if (position >= PgSearchDocument.MaxPosition) return;
        if (length >= PgSearchDocument.MaxLiteralLength) return;
        if (Buffer.byteLength(term, "utf8") > PgSearchDocument.MaxLexemeBytes) continue;
        position += 1;
        const at = `${position}${weight}`;
        const known = positions.get(term);
        if (known) {
          known.push(at);
          length += at.length + 1;
        } else {
          positions.set(term, [at]);
          length += term.length + at.length + 4;
        }
      }
    };
    add(label, "A");
    add(body, "B");

    return [...positions].map(([term, at]) => `'${term}':${at.join(",")}`).join(" ");
  }
}
