import { Info } from 'lucide-react'
import type { MediaStorageView } from '../../../api/types/media-storage'
import { MediaStorageDraft } from './media-storage-draft'
import styles from './MediaStoragePage.module.css'

/**
 * What a field is worth beside the box you type it in: nothing at all when the
 * file decides it, and what the server is using instead when it does not.
 *
 * This is the whole reason the page reads two configurations. Without it, an
 * operator types a bucket, watches it save, and the instance keeps using
 * another one, with nothing on screen admitting the difference.
 */
export function MediaStorageNote({ view, field }: { view: MediaStorageView; field: string }) {
  const inUse = MediaStorageDraft.inUse(view, field)
  if (!inUse) return null

  return (
    <span className={styles.note}>
      <Info size={12} />
      <span>
        In use: {inUse.value}
        {inUse.env ? ` (from ${inUse.env})` : ''}
      </span>
    </span>
  )
}
