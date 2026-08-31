import { Trash2, X } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import styles from './MediaLibrary.module.css'

interface Props {
  count: number
  onClear: () => void
  onDelete: () => void
}

/** Appears once anything is selected. Only rendered at all when the caller
 *  holds `media:delete` — the same claim the delete it offers needs. */
export function MediaSelectionBar({ count, onClear, onDelete }: Props) {
  return (
    <div className={styles.selectionBar}>
      <span className={styles.selectionCount}>{count} selected</span>
      <Button variant="secondary" size="sm" onClick={onClear}>
        <X size={13} /> Clear
      </Button>
      <Button variant="danger" size="sm" onClick={onDelete}>
        <Trash2 size={13} /> Delete
      </Button>
    </div>
  )
}
