import type { ReactNode } from 'react'
import { Link } from '../../router/Link'
import styles from './TopBar.module.css'

export interface Crumb {
  label: string
  /** Renders the crumb as a link; the last crumb is normally left plain. */
  to?: string
  onClick?: () => void
}

export function TopBar({
  crumbs,
  session,
  children,
}: {
  crumbs: Crumb[]
  session: string
  children?: ReactNode
}) {
  return (
    <div className={styles.topbar}>
      <div className={styles.breadcrumb}>
        {crumbs.map((c, i) => {
          const current = i === crumbs.length - 1
          const className = `${styles.crumb} ${current ? styles.current : c.to || c.onClick ? styles.link : ''}`
          return (
            <span key={i} className={styles.crumbPart}>
              {i > 0 && <span className={styles.separator}>/</span>}
              {c.to && !current ? (
                <Link to={c.to} className={className}>
                  {c.label}
                </Link>
              ) : (
                <button className={className} onClick={c.onClick} disabled={!c.onClick || current}>
                  {c.label}
                </button>
              )}
            </span>
          )
        })}
      </div>
      <div className={styles.right}>
        {children}
        <div className={styles.session}>
          <span className={styles.sessionDot} /> {session}
        </div>
      </div>
    </div>
  )
}
