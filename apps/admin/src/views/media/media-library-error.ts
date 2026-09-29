import { MediaFolderName } from '@silo/shared/media-folder-name'
import type { MediaUploadReport } from './media-upload-report'

/**
 * One place that decides what a failed media operation says.
 *
 * Separate messages for separate states, because the library keeps them in
 * separate cells: a staged deletion is a storage problem an operator fixes with
 * `silo media reconcile`, while a missing or malformed id is neither, and a
 * reload clears them at different times.
 */
export class MediaLibraryError {
  static message(failure: unknown, fallback: string): string {
    return failure instanceof Error ? failure.message : fallback
  }

  /** A plan the folder-name rule refused before a byte was sent (D105). */
  static uploadRefusedMessage(problem: string): string {
    return `Nothing was uploaded: ${problem}. ${MediaFolderName.Rule}`
  }

  /** How an upload that did not go cleanly ended, or `''` when it did. One
   *  file that fails says only why; a folder says how much went up first. */
  static uploadMessage(report: MediaUploadReport): string {
    const { total, uploaded, refused, stopped } = report
    if (stopped) return total <= 1 ? stopped : `Upload stopped after ${uploaded} of ${total} files: ${stopped}`
    const [first] = refused
    if (!first) return ''
    if (total <= 1 && refused.length === 1) return first.message
    return `${uploaded} uploaded, ${refused.length} refused. First: ${first.path}: ${first.message}`
  }

  static stalledMessage(count: number): string {
    const file = count === 1 ? 'file is' : 'files are'
    return `${count} ${file} staged for deletion but could not be removed from storage. Run "silo media reconcile".`
  }

  /** Covers both `not_found` and `invalid_id`: neither is a storage problem, so
   *  neither belongs in `stalled`, and both survive a reload the same way. */
  static deleteIssuesMessage(notFound: number, invalid: number): string {
    const parts: string[] = []
    if (notFound > 0) {
      parts.push(`${notFound} ${notFound === 1 ? 'file was' : 'files were'} already gone`)
    }
    if (invalid > 0) {
      parts.push(`${invalid} ${invalid === 1 ? 'id was' : 'ids were'} invalid`)
    }
    return `${parts.join(' and ')}; not deleted.`
  }
}
