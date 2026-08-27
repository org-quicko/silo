import type { Filter } from "@silo/shared/filter";
import type { SortKey } from "./sort-key";

export const DefaultLimit = 50;
export const MaxLimit = 500;
export const MaxFilterDepth = 10;
export const MaxFilterNodes = 50;

export interface Query {
  filter?: Filter;
  sort?: SortKey[];
  limit: number;
  offset: number;
}
