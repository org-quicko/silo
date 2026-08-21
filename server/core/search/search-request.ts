import type { Filter } from "@silo/shared/filter";
import type { SortKey } from "../query/sort-key";

/**
 * What to search and how far. The **reach** is expressed as a scope narrowing
 * rather than a parameter the caller may forget: the routes derive it from the
 * URL path (D19/D30), so a missing value cannot silently widen a search to the
 * whole instance.
 */
export interface SearchRequest {
  /** The user's text. Optional — a filter-only search is a legitimate query. */
  q?: string;
  /** Narrows to one project, and with `env` to one scope. */
  project?: string;
  env?: string;
  /** Narrows to one collection; requires `project` and `env`. */
  collection?: string;
  filter?: Filter;
  /**
   * When given, this order wins and relevance is ignored. When absent, a
   * non-empty `q` orders by relevance and everything else by `-$.updated_at`.
   */
  sort?: SortKey[];
  limit: number;
  offset: number;
}
