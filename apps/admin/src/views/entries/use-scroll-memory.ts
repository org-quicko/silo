import { useEffect, useLayoutEffect, useRef } from 'react'
import { ScrollMemory } from '../../utils/scroll-memory'

/**
 * Keeps a scrolling pane's position across leaving the view and coming back.
 *
 * Recorded continuously rather than on the way out: a reader leaves a list by a
 * row click, the breadcrumb, `Enter` on the cursor or the browser's own back
 * button, and none of those is a single place to hang a save.
 *
 * Restored in a layout effect, before paint, so the list does not visibly jump.
 * `ready` is what the caller knows and this does not — that the rows are
 * rendered, and the pane is therefore tall enough to scroll. A page whose
 * position was never recorded restores to the top, which is what paging or
 * changing a filter should do with a pane already scrolled halfway down.
 */
export function useScrollMemory(key: string, ready: boolean) {
  const pane = useRef<HTMLDivElement>(null)
  const restored = useRef<string | null>(null)

  useEffect(() => {
    const element = pane.current
    if (!element) return

    const onScroll = () => ScrollMemory.set(key, element.scrollTop)
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [key])

  useLayoutEffect(() => {
    const element = pane.current
    if (!element || !ready || restored.current === key) return
    restored.current = key
    element.scrollTop = ScrollMemory.get(key)
  }, [key, ready])

  return pane
}
