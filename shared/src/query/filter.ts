/**
 * One node of the Query AST (D29). Leaf ops address the virtual entry document
 * with an RFC 9535 path; group ops combine completed predicates.
 *
 * It lives in `shared` for the reason the path parser does: the admin UI's
 * filter builder, the server's validator and both storage compilers have to
 * agree on what a filter *is*, and a second declaration of it is a second
 * definition that can drift from the one being enforced.
 */
export interface Filter {
  /** See `FilterOps` for the closed set. */
  op: string;
  /** RFC 9535 path over the virtual entry document (D29). Leaf ops only. */
  path?: string;
  /** Leaf ops, except `exists`. */
  value?: any;
  /** `and`/`or`/`not`. */
  args?: Filter[];
}
