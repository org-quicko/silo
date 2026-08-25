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
 * navigating to the parent.
 */
export function SettingsNavItem({
  to,
  icon,
  title,
  subtitle,
  active,
  expanded,
  onToggleExpanded,
}: {
  to: string
  icon: ReactNode
  title: string
  subtitle: string
  active: boolean
  /** Omit both to render a leaf row. */
  expanded?: boolean
  onToggleExpanded?: () => void
}) {
  return (
    <div className={`${styles.row} ${active ? styles.active : ''}`}>
      <Link to={to} className={styles.navItem} aria-current={active ? 'page' : undefined}>
        <span className={styles.navIcon}>{icon}</span>
        <span className={styles.navItemText}>
          <span className={styles.navItemTitle}>{title}</span>
          <span className={styles.navItemSubtitle}>{subtitle}</span>
        </span>
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
