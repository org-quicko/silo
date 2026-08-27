import { Link } from '../../router/Link'
import styles from './Breadcrumb.module.css'

export interface Crumb {
  label: string
  /** Renders the crumb as a link; the last crumb is normally left plain. */
  to?: string
  onClick?: () => void
}

/**
 * The page's "where am I" line. It used to live in `TopBar`, over every page;
 * the redesign moves it into the page body so the top chrome has room for the
 * smart search bar (handoff 1b) — every page that used to pass `crumbs` to
 * `TopBar` now renders this instead, just below its own top edge.
 */
export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
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
  )
}
