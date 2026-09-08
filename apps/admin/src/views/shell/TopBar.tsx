import { Children, type ReactNode } from 'react'
import { Keyboard } from 'lucide-react'
import { ShortcutsManager } from './shortcuts-manager'
import styles from './TopBar.module.css'

/**
 * The top chrome: the smart search bar where the page has one — centred
 * regardless of what page-specific actions sit beside it — those actions,
 * and the keyboard-shortcuts button, always last so it stays the rightmost
 * thing on the bar. Settings pages pass no `search`: the bar only ever hands
 * off to the instance-wide collection/entry/media search, which has nothing
 * to search for there. What the connected key can do lives in the sidebar's
 * account row, not here.
 *
 * Every page renders its own `TopBar`, so the shortcuts button goes through
 * `ShortcutsManager` rather than a callback threaded down to however many
 * call sites there are — `ShortcutsHost`, mounted once near the app root,
 * is what actually renders the dialog.
 *
 * Renders nothing at all when it would otherwise be an empty strip — a page
 * whose only action is conditional (a claim the current key lacks, a state
 * that hasn't happened yet) should not leave a blank bar behind, and the
 * shortcuts button alone isn't reason enough to draw one either: most of
 * Settings has neither search nor page actions.
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
      <div className={styles.right}>
        {children}
        <button
          type="button"
          className={styles.shortcutsButton}
          onClick={ShortcutsManager.show}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard size={16} />
        </button>
      </div>
    </div>
  )
}
