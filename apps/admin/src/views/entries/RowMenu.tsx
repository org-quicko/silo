import { useEffect, useRef } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import styles from './RowMenu.module.css'

export function RowMenu({
  onClose,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
}: {
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  canEdit: boolean
  canDelete: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])
  return (
    <div ref={ref} className={styles.menu}>
      <button className={styles.item} onClick={onEdit}>
        <Pencil size={14} /> <span className={styles.label}>{canEdit ? 'Edit' : 'View'}</span>
      </button>
      {canDelete && (
        <button className={`${styles.item} ${styles.danger}`} onClick={onDelete}>
          <Trash2 size={14} /> <span className={styles.label}>Delete</span>
        </button>
      )}
    </div>
  )
}
