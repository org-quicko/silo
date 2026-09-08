import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from '../../router/Link'
import styles from './SettingsNav.module.css'

/**
 * One row of the settings nav, optionally the parent of a nested block.
 *
 * The row is a real `Link`, not a button, so a settings page can be
 * middle-clicked into a new tab and shows its target in the status bar — the
 * same reasoning `Link` itself documents. A parent row's disclosure control is
 * a **sibling** of that link rather than a child: nesting a button inside an
 * anchor is invalid, and it must be possible to expand the children without
 * navigating to the parent — and, through `onOpen`, to navigate to the parent
 * without having to then reach for the chevron.
 */
export function SettingsNavItem({
  to,
  icon,
  title,
  active,
  expanded,
  onToggleExpanded,
  onOpen,
}: {
  to: string
  icon: ReactNode
  title: string
  active: boolean
  /** Omit both to render a leaf row. */
  expanded?: boolean
  onToggleExpanded?: () => void
  /** Fired when the row itself is followed, so a parent can reveal its
   *  children on the way in. Not called for a modifier or middle click, which
   *  open a new tab and leave this one's nav alone. */
  onOpen?: () => void
}) {
  return (
    <div className={`${styles.row} ${active ? styles.active : ''}`}>
      <Link
        to={to}
        className={styles.navItem}
        aria-current={active ? 'page' : undefined}
        onNavigate={onOpen}
      >
        <span className={styles.navIcon}>{icon}</span>
        <span className={styles.navItemTitle}>{title}</span>
      </Link>

      {onToggleExpanded && (
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
          title={expanded ? `Collapse ${title}` : `Expand ${title}`}
          onClick={onToggleExpanded}
        >
          <ChevronRight size={13} className={expanded ? styles.chevronOpen : styles.chevron} />
        </button>
      )}
    </div>
  )
}
