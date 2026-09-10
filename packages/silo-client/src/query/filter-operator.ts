/** The closed set of operators the filter AST accepts: nine leaves that test
 *  one path, and three groups that combine nested nodes. */
export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "contains"
  | "exists"
  | "and"
  | "or"
  | "not";

/** The same set at runtime, so a drift test can compare it against the
 *  server's own vocabulary. An operator silo adds and the client does not
 *  offer is a gap a type alone cannot detect. */
export const FilterOperators: readonly FilterOperator[] = Object.freeze([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "contains",
  "exists",
  "and",
  "or",
  "not",
] as FilterOperator[]);
