import type { ScopeCopyCollectionPreview } from "./scope-copy-collection-preview";
import type { ScopeCopyPreviewEntry } from "./scope-copy-preview-entry";

/** A bounded detail page for a scope-copy dry-run. */
export interface ScopeCopyPreview {
  collections: ScopeCopyCollectionPreview[];
  entries: ScopeCopyPreviewEntry[];
  total: number;
  offset: number;
  limit: number;
}
