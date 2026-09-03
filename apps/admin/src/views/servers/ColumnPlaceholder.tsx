import type { LucideIcon } from 'lucide-react'
import { Spinner } from '../../components/feedback/Spinner'
import styles from './ServerManager.module.css'

interface Props {
  /** Omitted while loading, when the spinner takes its place. */
  icon?: LucideIcon
  loading?: boolean
  message: string
  hint?: string
}

/** What a column shows instead of rows: empty, unreachable, or loading. */
export function ColumnPlaceholder({ icon: Icon, loading, message, hint }: Props) {
  return (
    <div className={styles.emptyColumn}>
      {loading ? <Spinner className={styles.spinner} /> : Icon && <Icon size={22} className={styles.emptyIcon} />}
      <span>{message}</span>
      {hint && <small className="muted">{hint}</small>}
    </div>
  )
}
