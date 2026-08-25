import type { ReactNode } from 'react'
import type { AccessLevel } from '@silo/shared/access-level'
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

/**
 * The top chrome: the smart search bar (handoff 1b), any page-specific
 * actions, and the session pill. Breadcrumbs used to live here too; they now
 * render in the page body (see `Breadcrumb`), which is what makes room for a
 * bar wide enough to type a real query into.
 */
export function TopBar({
  search,
  session,
  children,
}: {
  search: ReactNode
  session: SessionBadge
  children?: ReactNode
}) {
  return (
    <div className={styles.topbar}>
      <div className={styles.searchSlot}>{search}</div>
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
