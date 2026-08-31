import { Folder, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import { MediaPath } from './media-path'
import styles from './MediaLibrary.module.css'

interface Props {
  path: string
  /** `undefined` while its count is still loading. */
  itemCount: number | undefined
  canEdit: boolean
  canDelete: boolean
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}

/**
 * One folder in the grid — an accent-tinted icon and an item count stand in
 * for the preview and file metadata a `MediaCard` shows.
 *
 * The open region is a `<button>` of its own inside the tile, not the tile
 * itself, because rename and delete are buttons too (D49) and a button
 * cannot nest another one.
 */
export function FolderTile({ path, itemCount, canEdit, canDelete, onOpen, onRename, onDelete }: Props) {
  const name = MediaPath.name(path)
  return (
    <div className={`${styles.card} ${styles.folderCard}`}>
      <button type="button" className={styles.folderOpen} onClick={onOpen}>
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

      {(canEdit || canDelete) && (
        <div className={styles.actions}>
          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              className={styles.iconAction}
              title="Rename or move"
              onClick={onRename}
            >
              <Pencil size={11} />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="dangerGhost"
              size="sm"
              className={styles.iconAction}
              title="Delete folder"
              onClick={onDelete}
            >
              <Trash2 size={11} />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
