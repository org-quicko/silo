/**
 * One line of a prepared transfer's plan (D110, D111): an entry, a destination
 * entry that replace removes, or a media asset or folder (`_media`,
 * `_media_folders`). A removed row's id and a destination row's `rev` are only
 * there for a key that may read that collection on this server.
 */
export interface TransferPlanItem {
  collection: string
  id?: string
  action: 'added' | 'updated' | 'unchanged' | 'skipped' | 'rejected' | 'deleted'
  /** A media line's filename, or its folder's path. */
  name?: string
  rev?: number
  updated_at?: string
  destination?: { rev: number; updated_at: string }
  reason?: string
  /** Media references this entry holds that will not resolve on this server. */
  unresolved?: string[]
}
