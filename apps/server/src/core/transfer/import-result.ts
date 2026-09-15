import type { ScopeCopyPreview } from "./scope-copy-preview";

export interface ImportResult {
  mode: string;
  dry_run: boolean;
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  /** Present only for a scoped dry-run that asks for a bounded preview. */
  scope_copy?: ScopeCopyPreview;
}
