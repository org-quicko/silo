/** One file and where it goes, as a folder path *relative to the destination*
 *  (`"photos/2024"`, and `""` for the destination itself). */
export interface PlannedUpload {
  file: File
  folder: string
}

/**
 * What an upload will do, worked out before anything is sent: which files go
 * to which folders, and which folders to make on their own.
 *
 * `emptyFolders` holds only the directories that had nothing inside. A folder
 * with a file under it exists once that file is uploaded (D20), so naming it
 * here would be a second request for a result the first already has.
 */
export interface MediaUploadPlan {
  uploads: PlannedUpload[]
  emptyFolders: string[]
}
