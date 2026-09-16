import type { ImportRejection } from "./import-rejection";
import type { ScopeCopyPreview } from "./scope-copy-preview";

export interface ImportResult {
  mode: string;
  dry_run: boolean;
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  /**
   * Entries the destination's schema refused (D69). Always present, and `0` on
   * a clean import — a caller checking whether anything was dropped must not
   * have to know the field is sometimes absent.
   */
  rejected: number;
  /** Which ones, up to `Importer.RejectionLimit`. `rejected` stays exact. */
  rejections: ImportRejection[];
  /** Present only for a scoped dry-run that asks for a bounded preview. */
  scope_copy?: ScopeCopyPreview;
}
