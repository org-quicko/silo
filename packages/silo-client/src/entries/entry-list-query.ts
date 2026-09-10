import type { FilterExpression } from "../query/filter-expression.js";
import type { SortTerm } from "../query/sort-term.js";

/** Everything `collection.list()` accepts, all optional. `where`
 * builds through `collection.filter`; `sort` takes a built `SortTerm` or a
 * raw string. */
export interface EntryListQuery {
  where?: FilterExpression;
  sort?: SortTerm | string;
  limit?: number;
  offset?: number;
}
