import type { LucideIcon } from 'lucide-react'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './ScopeBrowser.module.css'

interface Props {
  icon: LucideIcon
  title: string
  /** Omitted while the column is not reachable yet. */
  count?: number
  /** Present while a local search is filtering the list. */
  resultCount?: number
  search?: ReactNode
  active: boolean
  /** Omitted when the column has nothing to create. */
  onAdd?: () => void
  addTitle?: string
  /** A control at the far end of the header, opposite the title: the select-all
   *  box where the browser chooses rather than navigates. */
  headerAction?: ReactNode
  children: ReactNode
}

/** One pane of the server → project → environment browser. */
export function BrowserColumn({
  icon: Icon,
  title,
  count,
  resultCount,
  search,
  active,
  onAdd,
  addTitle,
  headerAction,
  children,
}: Props) {
  return (
    <div className={`${styles.column} ${active ? styles.columnActive : styles.columnInactive}`}>
      <div className={styles.columnHeader}>
        <div className={styles.columnTitle}>
          <Icon size={14} className={styles.columnIcon} />
          <span>{title}</span>
          {count !== undefined && (
            <span className={styles.counter} role="status" aria-label={
              resultCount === undefined
                ? `${count} ${title.toLowerCase()}`
                : `${resultCount} of ${count} ${title.toLowerCase()} match`
            }>
              {resultCount === undefined ? count : `${resultCount} / ${count}`}
            </span>
          )}
        </div>
        {headerAction}
        {onAdd && (
          <button type="button" className={styles.headerBtn} onClick={onAdd} title={addTitle}>
            <Plus size={14} />
          </button>
        )}
      </div>
      {search}
      <div className={styles.columnList}>{children}</div>
    </div>
  )
}
