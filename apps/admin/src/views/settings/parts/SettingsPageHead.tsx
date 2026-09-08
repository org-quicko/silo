import type { ReactNode } from 'react'
import { ScopeDescription, type Scope } from './scope-description'
import styles from './SettingsLedger.module.css'

/** A settings page's title, what its changes reach, and the page's own
 *  actions. `title` takes a node so a renamable name can be passed in.
 *  `scope`, when given, is a tooltip on the title rather than a visible
 *  chip — the breadcrumb and the nav item already say where a page reached
 *  from, so stating it a third time in the title was the same word repeated
 *  down the column. */
export function SettingsPageHead({
  title,
  scope,
  sub,
  mono,
  actions,
}: {
  title: ReactNode
  scope?: Scope
  sub?: ReactNode
  /** Set when the title is an identifier the API addresses. */
  mono?: boolean
  actions?: ReactNode
}) {
  return (
    <div className={styles.head}>
      <div className={styles.headText}>
        <h1
          className={`${styles.title} ${mono ? styles.titleMono : ''}`}
          title={scope ? ScopeDescription.of(scope) : undefined}
        >
          {title}
        </h1>
        {sub && <p className={styles.sub}>{sub}</p>}
      </div>
      {actions && <div className={styles.headActions}>{actions}</div>}
    </div>
  )
}
