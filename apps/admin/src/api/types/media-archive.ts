/** A prepared bulk download, `POST /api/media/archives` (D106). URLs are relative to the server. */
export interface MediaArchive {
  id: string
  expires_at: string
  files: number
  bytes: number
  parts: Array<{ part: number; filename: string; files: number; bytes: number; url: string }>
  /** Files too large to zip, each downloaded on its own. */
  separate: Array<{ id: string; filename: string; size: number; url: string }>
}
