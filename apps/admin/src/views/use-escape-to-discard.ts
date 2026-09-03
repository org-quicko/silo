import { useEffect, useRef } from 'react'

/**
 * Escape leaves an editor exactly the way its Discard/Cancel button does.
 *
 * A press already claimed by something else is left alone: the search bar
 * calls `preventDefault` on its own Escape (it closes the results and blurs),
 * so escaping a search never discards the form behind it. `active` is what a
 * caller uses to stand down while a dialog of its own is open, since that
 * dialog's Escape is for closing the dialog.
 */
export function useEscapeToDiscard(onDiscard: () => void, active: boolean): void {
  const latest = useRef(onDiscard)
  latest.current = onDiscard

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
