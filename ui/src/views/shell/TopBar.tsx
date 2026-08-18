import type { ReactNode } from 'react'
import { Lock, Globe } from 'lucide-react'
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
  onLock,
  onGoToServers,
  children,
}: {
  crumbs: Crumb[]
  session: string
  onLock: () => void
  onGoToServers?: () => void
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
        {onGoToServers && (
          <button
            type="button"
            className={`${styles.crumb} ${styles.link} ${styles.serverSwitch}`}
            onClick={onGoToServers}
          >
            <Globe size={14} /> Servers
          </button>
        )}
        <div className={styles.session}>
          <span className={styles.sessionDot} /> {session}
        </div>
        <button className={styles.iconButton} title="Disconnect / Switch Server" onClick={onLock}>
          <Lock size={15} />
        </button>
      </div>
    </div>
  )
}
