/**
 * A catalogued media asset (D23). `id` is what entries reference — the file
 * can be renamed or moved without any entry changing — and `usage_count` is
 * how many entries currently do, which is what makes a delete refusable
 * before it is attempted.
 */
export interface MediaAsset {
  id: string
  filename: string
  folder: string
  blob_key: string
  size: number
  content_type: string
  hash: string
  state: 'active' | 'deleting'
  tags: string[]
  url: string
  created_at: string
  updated_at: string
  usage_count?: number
}
