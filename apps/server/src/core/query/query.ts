import type { Filter } from "@silo/shared/filter";
import type { SortKey } from "./sort-key";

export const DefaultLimit = 50;
export const MaxLimit = 500;
export const MaxFilterDepth = 10;
export const MaxFilterNodes = 50;
/**
 * Leaf conditions per filter (D81). Every test of a `data` field is a scan of
 * the collection, and the scan costs each leaf per row: a 49-way `or` of
 * `contains` took 12 s over 200,000 rows where one took 0.6 s. Sixteen is far
 * more than a filter builder produces and caps the cost a caller can name.
 */
export const MaxFilterLeaves = 16;

export interface Query {
  filter?: Filter;
  sort?: SortKey[];
  limit: number;
  offset: number;
}
