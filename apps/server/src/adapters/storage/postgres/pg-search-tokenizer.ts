/**
 * `[search] tokenizer`, as the Postgres engine reads it (D30):
 *
 * - `unicode61`: words, as `SearchTokens` splits them, in a `tsvector`.
 * - `trigram`: substrings, through `pg_trgm`, for text with no spaces between
 *   words (CJK), which `unicode61` keeps as one term.
 */
export type PgSearchTokenizer = "unicode61" | "trigram";
