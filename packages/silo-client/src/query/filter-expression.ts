import type { FilterNode } from "./filter-node.js";

/**
 * A built filter, ready to combine or send. Wraps one `FilterNode` and
 * grows a bigger one on `and`/`or`/`not` rather than mutating what it wraps,
 * so `left.and(right).or(other)` never surprises a caller holding `left`.
 */
export class FilterExpression {
  constructor(private readonly node: FilterNode) {}

  and(other: FilterExpression): FilterExpression {
    return new FilterExpression({ op: "and", args: [this.node, other.node] });
  }

  or(other: FilterExpression): FilterExpression {
    return new FilterExpression({ op: "or", args: [this.node, other.node] });
  }

  not(): FilterExpression {
    return new FilterExpression({ op: "not", args: [this.node] });
  }

  /** The wire shape: what `?filter=` sends. */
  toJSON(): FilterNode {
    return this.node;
  }
}
