import { useEffect, useRef } from 'react'
import { SaveShortcut } from './save-shortcut'

/**
 * Wires `⌘S` / `Ctrl+S` for an editor view: always prevents the browser's
 * Save dialog while mounted, and invokes `onSave` once when `enabled` is true
 * and no modal dialog is stacked on top.
 */
export function useSaveShortcut(onSave: () => void, enabled: boolean): void {
  const latestSave = useRef(onSave)
  const latestEnabled = useRef(enabled)

  useEffect(() => {
    latestSave.current = onSave
  }, [onSave])

  useEffect(() => {
    latestEnabled.current = enabled
  }, [enabled])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!SaveShortcut.matches(event) || event.defaultPrevented) return
      event.preventDefault()
      if (!latestEnabled.current) return
      if (typeof document !== 'undefined' && document.querySelector('[role="dialog"], [aria-modal="true"]')) {
        return
      }
      latestSave.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
