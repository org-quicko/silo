import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from '../../../router/Link'
import styles from './SettingsLedger.module.css'

/**
 * One entry in an index: its name, the path or id that addresses it, and
 * whatever count belongs on the right.
 *
 * The whole row is the link to that thing's own page — which is also where its
 * destructive actions live, so a list never carries a delete button one stray
 * click from taking everything underneath it.
 */
export function SettingsListRow({
  to,
  icon,
  name,
  meta,
  right,
  title,
}: {
  to: string
  icon?: ReactNode
  name: string
  meta?: ReactNode
  right?: ReactNode
  title?: string
}) {
  return (
    <Link to={to} className={styles.listRow} title={title}>
      {icon && <span className={styles.listIcon}>{icon}</span>}
      <span className={styles.listBody}>
        <span className={styles.listName}>{name}</span>
        {meta && <span className={styles.listMeta}>{meta}</span>}
      </span>
      <span className={styles.listRight}>
        {right}
        <ChevronRight size={15} />
      </span>
    </Link>
  )
}
