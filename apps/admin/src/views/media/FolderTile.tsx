import { Folder } from 'lucide-react'
import { MediaPath } from './media-path'
import styles from './MediaLibrary.module.css'

interface Props {
  path: string
  /** `undefined` while its count is still loading. */
  itemCount: number | undefined
  onOpen: () => void
}

/** One folder in the grid — an accent-tinted icon and an item count stand in
 *  for the preview and file metadata a `MediaCard` shows, so the two read as
 *  different kinds of tile at a glance. */
export function FolderTile({ path, itemCount, onOpen }: Props) {
  const name = MediaPath.name(path)
  return (
    <button type="button" className={`${styles.card} ${styles.folderCard}`} onClick={onOpen}>
      <div className={styles.folderPreview}>
        <Folder size={36} strokeWidth={1.5} />
      </div>
      <div className={styles.info}>
        <span className={styles.name} title={name}>
          {name}
        </span>
        <div className={styles.meta}>
          <span>{itemCount === undefined ? '…' : `${itemCount} item${itemCount === 1 ? '' : 's'}`}</span>
        </div>
      </div>
    </button>
  )
}
