import type { SearchAccess } from "./search-access";
import type { SearchRequest } from "./search-request";
import type { SearchResult } from "./search-result";
import type { SearchTarget } from "./search-target";

/**
 * The search port (D30).
 *
 * Search is a port and not a Query AST operator because §5.3 makes every
 * operator permanent for every adapter: a full-text op would oblige a future
 * Turso, S3 or Postgres adapter to reproduce relevance ranking forever. A port
 * lets each answer with what it has, and lets `ScanSearcher` cover the ones
 * that have nothing.
 *
 * `access` is separate from `request` on purpose. A request says what the
 * caller wants; access says what they may have. Merging them would make it
 * possible to write an engine that reads the wrong one.
 */
export interface Searcher {
  search(request: SearchRequest, access: SearchAccess): Promise<SearchResult>;

  /**
   * Rebuild whatever derived state the engine keeps, narrowed to `target` when
   * given. A no-op for an engine that keeps none.
   */
  reindex(target?: SearchTarget): Promise<{ collections: number; entries: number }>;

  capabilities(): { engine: "fts5" | "scan"; snippets: boolean };
}
