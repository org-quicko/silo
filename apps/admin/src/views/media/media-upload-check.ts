import { MediaFolderName } from '@silo/shared/media-folder-name'
import { MediaPath } from './media-path'
import type { MediaUploadPlan } from './media-upload-plan'

/**
 * Asks the server's folder-name rule of a whole plan before anything is sent
 * (D105). An upload that stopped at the first bad name would leave half a tree
 * behind, and there is no way to say which half.
 */
export class MediaUploadCheck {
  /** Why `plan` cannot go under `destination`, or null when the server will
   *  take every folder in it. Names the first folder that breaks the rule. */
  static problem(plan: MediaUploadPlan, destination: string): string | null {
    const base = MediaPath.segments(destination).length
    const folders = new Set([...plan.uploads.map((upload) => upload.folder), ...plan.emptyFolders])
    for (const folder of folders) {
      const segments = folder.split('/').filter(Boolean)
      if (segments.length === 0) continue
      const deep = MediaFolderName.depthProblem(base + segments.length)
      if (deep) return deep
      for (const segment of segments) {
        const problem = MediaFolderName.segmentProblem(segment)
        if (problem) return problem
      }
    }
    return null
  }
}
