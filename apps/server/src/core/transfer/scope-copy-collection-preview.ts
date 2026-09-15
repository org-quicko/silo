/** Per-collection schema and entry totals for a scope-copy dry-run. */
export interface ScopeCopyCollectionPreview {
  collection: string;
  schema: "create" | "update" | "unchanged";
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
}
