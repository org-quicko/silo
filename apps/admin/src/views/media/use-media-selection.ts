import { useCallback, useState } from 'react'

/**
 * Which asset ids are selected for a bulk operation — split out of
 * `useMediaLibrary` (D49 audit fix), which was doing list state, selection
 * state and delete orchestration together. Folders are never selectable,
 * since folder delete is a separate, empty-folder-only route.
 *
 * `resetKey` names the page a selection belongs to — callers pass a value
 * (built with, say, `JSON.stringify` over the fields that define a page, so
 * two different pages can never collide onto the same string) that changes
 * whenever the folder, offset or query does. Selection clears whenever it
 * changes: it names rows on the page being left, not ones on the page being
 * entered. Reset during render (React's documented pattern for state derived
 * from other state) rather than in an effect, which would cost an extra
 * commit for a set-state-in-effect lint has no way to know is unavoidable
 * here.
 */
export function useMediaSelection(resetKey: string) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const [lastResetKey, setLastResetKey] = useState(resetKey)
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey)
    setSelected(new Set())
  }

  return {
    selected,
    clearSelection,

    toggleSelected: (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },

    /** The header checkbox in list view: selects or clears every id given —
     *  the current page's assets, never a folder. */
    selectMany: (ids: string[], on: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of ids) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      })
    },
  }
}
