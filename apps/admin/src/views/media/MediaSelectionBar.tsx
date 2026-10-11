import { Download, FolderInput, Trash2, X } from 'lucide-react'
import { Button } from '../../components/buttons/Button'
import styles from './MediaLibrary.module.css'

interface Props {
  count: number
  /** Each action shows only when the key holds the claim it needs; Download
   *  needs none beyond a key (D106). */
  canMove: boolean
  canDelete: boolean
  downloading: boolean
  onClear: () => void
  onDownload: () => void
  onMove: () => void
  onDelete: () => void
}

/** Appears once anything is selected. */
export function MediaSelectionBar({
  count,
  canMove,
  canDelete,
  downloading,
  onClear,
  onDownload,
  onMove,
  onDelete,
}: Props) {
  return (
    <div className={styles.selectionBar}>
      <span className={styles.selectionCount}>{count} selected</span>
      <Button variant="secondary" size="sm" onClick={onClear}>
        <X size={13} /> Clear
      </Button>
      <Button variant="secondary" size="sm" onClick={onDownload} disabled={downloading}>
        <Download size={13} /> {downloading ? 'Preparing…' : 'Download'}
      </Button>
      {canMove && (
        <Button variant="secondary" size="sm" onClick={onMove}>
          <FolderInput size={13} /> Move
        </Button>
      )}
      {canDelete && (
        <Button variant="danger" size="sm" onClick={onDelete}>
          <Trash2 size={13} /> Delete
        </Button>
      )}
    </div>
  )
}
