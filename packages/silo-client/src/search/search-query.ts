import type { FilterExpression } from "../query/filter-expression.js";
import type { SortTerm } from "../query/sort-term.js";

/** Everything a search accepts, all optional. `query` maps to the wire's
 *  `q`; omitting `sort` ranks by relevance instead. */
export interface SearchQuery {
  query?: string;
  where?: FilterExpression;
  sort?: SortTerm | string;
  limit?: number;
  offset?: number;
}
