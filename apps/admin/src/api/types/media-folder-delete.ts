import type { MediaBulkDeleteResult } from './media-bulk-delete'

/**
 * The body `DELETE /api/media/folders?recursive=true` and `POST
 * /api/media/purge` both answer with (D49): the same per-id outcomes
 * `POST /api/media/delete` does, plus how many `_media_folders` records were
 * removed. `folders_deleted` is `0` whenever anything inside was left
 * behind — the folder or the library is not actually empty, so nothing about
 * its records was touched.
 */
export interface MediaFolderDeleteResult extends MediaBulkDeleteResult {
  folders_deleted: number
}
