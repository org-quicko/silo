import { useEffect } from 'react'
import { Keyboard } from '../../utils/keyboard'
import { router } from '../../router/router'
import { ShortcutsManager } from './shortcuts-manager'

/**
 * The shortcuts that belong to the shell rather than to a page: `?` opens the
 * shortcut list (through `ShortcutsManager`, the same door the header
 * button uses), and `Ctrl`/`⌘` `,` goes to Settings.
 *
 * `?` stands down while someone is typing, because it is a character they meant
 * to write. The Settings shortcut does not, for the same reason `⌘K` does not:
 * a modified press types nothing, so an open field has no claim on it.
 */
export function useShellShortcuts(settingsTo: string): void {
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
      ShortcutsManager.show()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsTo])
}
