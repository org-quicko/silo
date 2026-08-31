import type { MediaUsage } from './media-usage'

/**
 * One id's outcome in `POST /api/media/delete` (D48). `code` mirrors the
 * server's per-id failure codes; `usage_count`, `visible_count` and
 * `referrers` are only present for `media_in_use`, the same claim-filtered
 * facts the single-delete 409 carries.
 */
export interface MediaBulkDeleteFailure {
  id: string
  code: 'media_in_use' | 'not_found' | 'media_delete_stalled' | 'invalid_id'
  message: string
  usage_count?: number
  visible_count?: number
  referrers?: MediaUsage[]
}

/**
 * The body `POST /api/media/delete` always answers with, at `200` either
 * way: the request itself succeeded, and each id's outcome is data rather
 * than a status code (D48).
 */
export interface MediaBulkDeleteResult {
  deleted: string[]
  failed: MediaBulkDeleteFailure[]
}
