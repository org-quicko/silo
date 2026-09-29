import { SiloError, ValidationFailedError } from '../../api/api-error'
import { MediaLibraryError } from './media-library-error'
import { MediaPath } from './media-path'
import type { MediaUploadPlan } from './media-upload-plan'
import type { MediaUploadReport } from './media-upload-report'

/** What an upload needs from the server, so a run can be tested against a
 *  stub. Folders are absolute library paths, `""` being the root. */
export interface MediaUploadTarget {
  upload(file: File, folder: string): Promise<unknown>
  createFolder(path: string): Promise<unknown>
}

/**
 * Sends a {@link MediaUploadPlan}, one file at a time (D105).
 *
 * A file the server refuses is recorded and skipped, because stopping would
 * leave the reader to upload the folder again and get a second copy of every
 * file that had already gone up. Anything else (the network, a credential, a
 * server error) would fail the next file the same way, so it ends the run.
 *
 * The subfolders are not made here: the server files each upload under its
 * path and every ancestor exists from then on (D20). Only a directory that
 * held nothing needs a request of its own.
 */
export class MediaUploader {
  static async run(
    plan: MediaUploadPlan,
    destination: string,
    target: MediaUploadTarget,
    onProgress: (handled: number) => void = () => {},
  ): Promise<MediaUploadReport> {
    const report: MediaUploadReport = { total: plan.uploads.length, uploaded: 0, refused: [], stopped: null }

    for (const { file, folder } of plan.uploads) {
      try {
        await target.upload(file, folder ? MediaPath.child(destination, folder) : destination)
        report.uploaded++
      } catch (failure: unknown) {
        const message = MediaLibraryError.message(failure, 'Upload failed')
        if (!MediaUploader.isRefusal(failure)) {
          report.stopped = message
          return report
        }
        report.refused.push({ path: folder ? `${folder}/${file.name}` : file.name, message })
      }
      onProgress(report.uploaded + report.refused.length)
    }

    for (const folder of plan.emptyFolders) {
      try {
        await target.createFolder(MediaPath.child(destination, folder))
      } catch (failure: unknown) {
        const message = MediaLibraryError.message(failure, 'Could not create the folder')
        if (!MediaUploader.isRefusal(failure)) {
          report.stopped = message
          return report
        }
        report.refused.push({ path: folder, message })
      }
    }
    return report
  }

  /** A refusal of this one file: it broke a rule (`400`) or was too large
   *  (`413`). Not a reason to think the next one will fare the same. */
  private static isRefusal(failure: unknown): boolean {
    return failure instanceof ValidationFailedError || (failure instanceof SiloError && failure.status === 413)
  }
}
