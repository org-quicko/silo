import { FolderInput, Trash2, X } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import styles from './MediaLibrary.module.css'

interface Props {
  count: number
  /** Whether Move shows: the same claim a single item's Move action needs,
   *  which is not the one that put this bar on screen. */
  canMove: boolean
  onClear: () => void
  onMove: () => void
  onDelete: () => void
}

/** Appears once anything is selected. Only rendered at all when the caller
 *  holds `media:delete` — the same claim the delete it offers needs. */
export function MediaSelectionBar({ count, canMove, onClear, onMove, onDelete }: Props) {
  return (
    <div className={styles.selectionBar}>
      <span className={styles.selectionCount}>{count} selected</span>
      <Button variant="secondary" size="sm" onClick={onClear}>
        <X size={13} /> Clear
      </Button>
      {canMove && (
        <Button variant="secondary" size="sm" onClick={onMove}>
          <FolderInput size={13} /> Move
        </Button>
      )}
      <Button variant="danger" size="sm" onClick={onDelete}>
        <Trash2 size={13} /> Delete
      </Button>
    </div>
  )
}
