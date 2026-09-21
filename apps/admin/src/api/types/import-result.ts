import type { ImportRejection } from './import-rejection'
import type { ScopeCopyPreview } from './scope-copy-preview'

export interface ImportResult {
  mode: string
  dry_run: boolean
  added: number
  updated: number
  deleted: number
  skipped: number
  /** Entries the destination's schema refused (D70). A dry run reports 0:
   *  the schemas it would write are unwritten, so it cannot judge them yet. */
  rejected: number
  /** Which ones, capped by the server. `rejected` stays exact. */
  rejections: ImportRejection[]
  /** What the run did about media bytes. Absent for a scope copy, which
   *  touches none. */
  media?: {
    files: number
    /** Whether the destination library was emptied first. Only a replace of a
     *  whole-library archive does that. */
    cleared: boolean
  }
  scope_copy?: ScopeCopyPreview
}
