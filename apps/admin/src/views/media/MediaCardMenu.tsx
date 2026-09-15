import { useEffect, useRef } from 'react'
import { Eye, FolderInput, Link, Pencil, Trash2 } from 'lucide-react'
import styles from './MediaLibrary.module.css'

interface Props {
  onPreview?: () => void
  onCopyLink?: () => void
  canRename: boolean
  onRename: () => void
  canMove: boolean
  onMove: () => void
  canDelete: boolean
  deleteTitle?: string
  onDelete: () => void
  onClose: () => void
}

/** The grid tile's "more" menu — Preview, Copy link (files only), Rename, Move,
 *  Delete — replacing the persistent action row a hover-only tile has no room
 *  for. Rename and Move are separate items because they are separate questions
 *  (D66). */
export function MediaCardMenu({
  onPreview,
  onCopyLink,
  canRename,
  onRename,
  canMove,
  onMove,
  canDelete,
  deleteTitle,
  onDelete,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])

  return (
    <div ref={ref} className={styles.cardMenu} onClick={(e) => e.stopPropagation()}>
      {onPreview && (
        <button type="button" className={styles.cardMenuItem} onClick={onPreview}>
          <Eye size={14} /> <span>Preview</span>
        </button>
      )}
      {onCopyLink && (
        <button type="button" className={styles.cardMenuItem} onClick={onCopyLink}>
          <Link size={14} /> <span>Copy link</span>
        </button>
      )}
      {canRename && (
        <button type="button" className={styles.cardMenuItem} onClick={onRename}>
          <Pencil size={14} /> <span>Rename</span>
        </button>
      )}
      {canMove && (
        <button type="button" className={styles.cardMenuItem} onClick={onMove}>
          <FolderInput size={14} /> <span>Move</span>
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className={`${styles.cardMenuItem} ${styles.cardMenuDanger}`}
          title={deleteTitle}
          onClick={onDelete}
        >
          <Trash2 size={14} /> <span>Delete</span>
        </button>
      )}
    </div>
  )
}
