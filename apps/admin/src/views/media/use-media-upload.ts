import { useState } from 'react'
import { api } from '../../api/silo-api'
import { MediaLibraryError } from './media-library-error'
import { MediaUploadCheck } from './media-upload-check'
import type { MediaUploadPlan } from './media-upload-plan'
import { MediaUploadPlanner } from './media-upload-planner'
import { MediaUploader } from './media-uploader'

/** How far an upload has got, in files. */
export interface MediaUploadProgress {
  done: number
  total: number
}

/**
 * Uploads what a reader picked or dropped into `folder` (D105): files, or
 * folders with their subfolders.
 *
 * `onChanged` is awaited before a problem is reported. A successful reload
 * clears the library's error banner, so the other order would show the
 * message for as long as the listing takes to load.
 */
export function useMediaUpload(
  url: string,
  apiKey: string,
  folder: string,
  onChanged: () => Promise<void>,
  onProblem: (message: string) => void,
) {
  const [progress, setProgress] = useState<MediaUploadProgress | null>(null)

  const run = async (plan: MediaUploadPlan) => {
    const total = plan.uploads.length
    if (total === 0 && plan.emptyFolders.length === 0) return

    const problem = MediaUploadCheck.problem(plan, folder)
    if (problem) {
      onProblem(MediaLibraryError.uploadRefusedMessage(problem))
      return
    }

    setProgress({ done: 0, total })
    try {
      const report = await MediaUploader.run(
        plan,
        folder,
        {
          upload: (file, destination) => api.media.upload(url, apiKey, file, destination || undefined),
          createFolder: (path) => api.media.createFolder(url, apiKey, path),
        },
        (done) => setProgress({ done, total }),
      )
      await onChanged()
      const message = MediaLibraryError.uploadMessage(report)
      if (message) onProblem(message)
    } finally {
      setProgress(null)
    }
  }

  return {
    progress,
    uploadFiles: (files: FileList) => run(MediaUploadPlanner.fromFiles(Array.from(files))),
    /** Takes the drop's entries before its first `await`; see `fromDrop`. */
    uploadDropped: (transfer: DataTransfer) =>
      MediaUploadPlanner.fromDrop(transfer).then(run, (failure: unknown) =>
        onProblem(MediaLibraryError.message(failure, 'Could not read the dropped items')),
      ),
  }
}
