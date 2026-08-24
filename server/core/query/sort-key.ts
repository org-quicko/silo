export interface SortKey {
  /** A singular RFC 9535 path (D29) — a wildcard has no deterministic order. */
  path: string;
  desc: boolean;
}
