import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './ScopeBrowser.module.css'

interface Props {
  title: string
  subtitle?: string
  selected: boolean
  /** Staggers the entrance so a long list does not appear all at once. */
  index: number
  chevron?: boolean
  onSelect: () => void
  onActivate?: () => void
  /** A control before the name — a checkbox where the browser chooses rather
   *  than navigates. It handles its own clicks; the row still selects. */
  lead?: ReactNode
  /** A control on the right of the row, before the chevron. */
  action?: ReactNode
}

/** One selectable row in a browser column. */
export function ColumnItem({
  title,
  subtitle,
  selected,
  index,
  chevron,
  onSelect,
  onActivate,
  lead,
  action,
}: Props) {
  return (
    <div
      className={`${styles.columnItem} ${selected ? styles.selected : ''}`}
      onClick={onSelect}
      onDoubleClick={onActivate}
      style={{ animationDelay: `${index * 25}ms` }}
    >
      {lead}
      <div className={styles.itemMain}>
        <span className={styles.itemTitle}>{title}</span>
        {subtitle && <span className={styles.itemSubtitle}>{subtitle}</span>}
      </div>
      {action}
      {chevron && <ChevronRight size={14} className={styles.chevron} />}
    </div>
  )
}
