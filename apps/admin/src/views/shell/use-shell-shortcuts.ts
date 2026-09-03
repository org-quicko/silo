import { useEffect, useRef } from 'react'
import { Keyboard } from '../../utils/keyboard'
import { router } from '../../router/router'

/**
 * The shortcuts that belong to the shell rather than to a page: `?` opens the
 * shortcut list, and `Ctrl`/`⌘` `,` goes to Settings.
 *
 * `?` stands down while someone is typing, because it is a character they meant
 * to write. The Settings shortcut does not, for the same reason `⌘K` does not:
 * a modified press types nothing, so an open field has no claim on it.
 */
export function useShellShortcuts(settingsTo: string, onShowShortcuts: () => void): void {
  // Held in a ref so the listener binds once per route rather than per render.
  const showShortcuts = useRef(onShowShortcuts)
  showShortcuts.current = onShowShortcuts

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ',' && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault()
        router.navigate(settingsTo)
        return
      }
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return
      if (Keyboard.isTyping(event.target)) return
      event.preventDefault()
      showShortcuts.current()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsTo])
}
