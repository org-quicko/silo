import type { ReactNode } from 'react'
import type { AccessLevel } from '@silo/shared/access-level'
import { Link } from '../../router/Link'
import type { SessionBadge } from './session-badge'
import styles from './TopBar.module.css'

/**
 * Phrased from the reader's side ("what can I do here"), not the claim
 * grammar's — the claims themselves are on the Keys page.
 */
const ACCESS_TEXT: Record<AccessLevel, string> = {
  root: 'Full access',
  write: 'Read & write',
  read: 'Read-only',
  none: 'No access',
}

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
  session: SessionBadge
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
        <div
          className={`${styles.session} ${styles[session.level]}`}
          title={session.detail}
        >
          <span className={styles.sessionDot} /> {ACCESS_TEXT[session.level]}
        </div>
      </div>
    </div>
  )
}
