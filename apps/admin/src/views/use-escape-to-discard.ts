import { useEffect, useRef } from 'react'

/**
 * Escape leaves an editor exactly the way its Discard/Cancel button does.
 *
 * A press already claimed by something else is left alone: the search bar
 * calls `preventDefault` on its own Escape (it closes the results and blurs),
 * so escaping a search never discards the form behind it. `active` lets a
 * caller stand down while a dialog of its own is open, and any open modal
 * dialog (`[role="dialog"]`) claims Escape first.
 */
export function useEscapeToDiscard(onDiscard: () => void, active: boolean): void {
  const latest = useRef(onDiscard)

  useEffect(() => {
    latest.current = onDiscard
  }, [onDiscard])

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (typeof document !== 'undefined' && document.querySelector('[role="dialog"], [aria-modal="true"]')) {
        return
      }
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
