/** One planned scope-copy entry action; protected destination ids are omitted. */
export interface ScopeCopyPreviewEntry {
  collection: string;
  id?: string;
  action: "added" | "updated" | "deleted" | "skipped";
}
