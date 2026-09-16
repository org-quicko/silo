import type { ImportRejection } from './import-rejection'
import type { ScopeCopyPreview } from './scope-copy-preview'

export interface ImportResult {
  mode: string
  dry_run: boolean
  added: number
  updated: number
  deleted: number
  skipped: number
  /** Entries the destination's schema refused (D69). A dry run reports 0:
   *  the schemas it would write are unwritten, so it cannot judge them yet. */
  rejected: number
  /** Which ones, capped by the server. `rejected` stays exact. */
  rejections: ImportRejection[]
  scope_copy?: ScopeCopyPreview
}
