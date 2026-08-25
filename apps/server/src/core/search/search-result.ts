import type { SearchHit } from "./search-hit";

export interface SearchResult {
  items: SearchHit[];
  /** Exact for what was visited; see `truncated`. */
  total: number;
  limit: number;
  offset: number;
  /**
   * True when a scan stopped at its visit cap or time budget, so `total`
   * counts what was examined rather than what exists.
   */
  truncated: boolean;
  engine: "fts5" | "scan";
}
