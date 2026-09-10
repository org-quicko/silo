/** Which engine answered a search: the portable in-process scan, or SQLite
 *  FTS5 where the build has it. */
export type SearchEngine = "fts5" | "scan";
