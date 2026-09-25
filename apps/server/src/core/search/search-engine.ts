/**
 * Which engine answered a search (D30): SQLite's FTS5 index, Postgres's text
 * search, or `scan`, the portable walk that keeps no index and may truncate.
 */
export type SearchEngine = "fts5" | "postgres" | "scan";
