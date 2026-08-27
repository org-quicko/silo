import type { LucideIcon } from 'lucide-react'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './ServerManager.module.css'

interface Props {
  icon: LucideIcon
  title: string
  /** Omitted while the column is not reachable yet. */
  count?: number
  active: boolean
  /** Omitted when the column has nothing to create. */
  onAdd?: () => void
  addTitle?: string
  children: ReactNode
}

/** One pane of the server → project → environment browser. */
export function BrowserColumn({
  icon: Icon,
  title,
  count,
  active,
  onAdd,
  addTitle,
  children,
}: Props) {
  return (
    <div className={`${styles.column} ${active ? styles.columnActive : styles.columnInactive}`}>
      <div className={styles.columnHeader}>
        <div className={styles.columnTitle}>
          <Icon size={14} className={styles.columnIcon} />
          <span>{title}</span>
          {count !== undefined && <span className={styles.counter}>{count}</span>}
        </div>
        {onAdd && (
          <button type="button" className={styles.headerBtn} onClick={onAdd} title={addTitle}>
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className={styles.columnList}>{children}</div>
    </div>
  )
}
