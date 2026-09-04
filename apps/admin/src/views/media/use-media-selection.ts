import { useCallback, useState } from 'react'

/**
 * Which asset ids and folder paths are selected for a bulk operation — split
 * out of `useMediaLibrary` (D49 audit fix), which was doing list state,
 * selection state and delete orchestration together. Folders and files share
 * one bulk delete (`useMediaDeleteFlow`'s `mixed` subject), so they share one
 * selection here too, kept as two sets rather than one tagged set: asset ids
 * and folder paths are drawn from different id spaces and every existing
 * caller of `selected`/`toggleSelected` already assumes assets-only.
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
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set())
  const clearSelection = useCallback(() => {
    setSelected(new Set())
    setSelectedFolders(new Set())
  }, [])

  const [lastResetKey, setLastResetKey] = useState(resetKey)
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey)
    setSelected(new Set())
    setSelectedFolders(new Set())
  }

  return {
    selected,
    selectedFolders,
    clearSelection,

    toggleSelected: (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },

    toggleFolderSelected: (path: string) => {
      setSelectedFolders((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
    },

    /** The header checkbox in list view: selects or clears every asset and
     *  folder on the current page. */
    selectAllOnPage: (assetIds: string[], folderPaths: string[], on: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of assetIds) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      })
      setSelectedFolders((prev) => {
        const next = new Set(prev)
        for (const path of folderPaths) {
          if (on) next.add(path)
          else next.delete(path)
        }
        return next
      })
    },
  }
}
