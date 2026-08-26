import { Children, type ReactNode } from 'react'
import styles from './TopBar.module.css'

/**
 * The top chrome: the smart search bar where the page has one — centred
 * regardless of what page-specific actions sit beside it — plus those
 * actions. Settings pages pass no `search`: the bar only ever hands off to
 * the instance-wide collection/entry/media search, which has nothing to
 * search for there. What the connected key can do lives in the sidebar's
 * account row, not here.
 *
 * Renders nothing at all when it would otherwise be an empty strip — a page
 * whose only action is conditional (a claim the current key lacks, a state
 * that hasn't happened yet) should not leave a blank bar behind.
 */
export function TopBar({
  search,
  children,
}: {
  search?: ReactNode
  children?: ReactNode
}) {
  const hasActions = Children.toArray(children).length > 0
  if (!search && !hasActions) return null

  return (
    <div className={styles.topbar}>
      {search && <div className={styles.searchSlot}>{search}</div>}
      <div className={styles.right}>{children}</div>
    </div>
  )
}
