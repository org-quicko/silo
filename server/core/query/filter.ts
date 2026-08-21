export interface Filter {
  /**
   * `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, `exists` (leaf);
   * `not` (exactly one arg); `and`, `or`.
   */
  op: string;
  /** RFC 9535 path over the virtual entry document (D29). Leaf ops only. */
  path?: string;
  /** Leaf ops, except `exists`. */
  value?: any;
  /** `and`/`or`/`not`. */
  args?: Filter[];
}
