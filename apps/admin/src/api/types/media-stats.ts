export type MediaKindName = 'image' | 'video' | 'audio' | 'document' | 'other'

/** `GET /api/media/stats` (D106). Files staged for deletion are only in `deleting`. */
export interface MediaStats {
  files: number
  bytes: number
  folders: number
  types: Array<{ type: MediaKindName; files: number; bytes: number }>
  largest: { id: string; filename: string; folder: string; size: number } | null
  last_upload: string | null
  deleting: number
}
