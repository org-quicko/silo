import type { ImportOptions } from "./import-options";

export interface ScopeCopyOptions extends ImportOptions {
  selection?: ScopeCopySelection[];
}

/** A collection, or a precise non-empty set of its entries, to copy. */
export interface ScopeCopySelection {
  collection: string;
  entryIds?: string[];
}
