import type { FilterOperator } from "./filter-operator.js";

/** One node of the wire's filter AST: a leaf tests `path` against `value`, a
 *  group combines nested nodes in `args`. */
export interface FilterNode {
  op: FilterOperator;
  path?: string;
  value?: unknown;
  args?: FilterNode[];
}
