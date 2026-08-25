/**
 * The closed set of Query AST operators (D29/§5.3), and what each one takes.
 *
 * Shared because the admin UI offers these in a menu and the server validates
 * against them: an op the builder offers but the validator refuses is a `400`
 * the user cannot act on, and the only way to be sure that cannot happen is
 * for both to read the same list.
 */
export type FilterArity = "value" | "values" | "path";

export class FilterOps {
  /**
   * Leaf ops in the order a menu should offer them — equality first, then the
   * comparisons, then the two that are neither.
   */
  static readonly Leaf: readonly { op: string; label: string; arity: FilterArity }[] = [
    { op: "eq", label: "is", arity: "value" },
    { op: "neq", label: "is not", arity: "value" },
    { op: "contains", label: "contains", arity: "value" },
    { op: "gt", label: "greater than", arity: "value" },
    { op: "gte", label: "at least", arity: "value" },
    { op: "lt", label: "less than", arity: "value" },
    { op: "lte", label: "at most", arity: "value" },
    { op: "in", label: "is one of", arity: "values" },
    { op: "exists", label: "is present", arity: "path" },
  ];

  static readonly Group: readonly string[] = ["and", "or", "not"];

  private static readonly leafByOp = new Map(FilterOps.Leaf.map((l) => [l.op, l]));

  static isLeaf(op: string): boolean {
    return FilterOps.leafByOp.has(op);
  }

  static isGroup(op: string): boolean {
    return FilterOps.Group.includes(op);
  }

  /** How the op reads its operand, or `null` when the op is not a leaf. */
  static arity(op: string): FilterArity | null {
    return FilterOps.leafByOp.get(op)?.arity ?? null;
  }

  /** The verb a UI should print for the op — `op` itself when it is unknown. */
  static label(op: string): string {
    return FilterOps.leafByOp.get(op)?.label ?? op;
  }
}
