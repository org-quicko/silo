import { useEffect, useRef, useState } from 'react'
import { Keyboard } from '../../utils/keyboard'
import { EntriesShortcuts, type EntriesAction } from './entries-shortcuts'

/** Everything the entries list's keyboard can reach. */
export interface EntriesKeyboardOptions {
  rowCount: number
  /** False while a dialog owns the keyboard, so nothing reaches the page behind it. */
  active: boolean
  /** The row cursor, by index — `null` when no row is under it. */
  onOpen: (index: number) => void
  onDelete: (index: number) => void
  onNew: () => void
  onFilter: () => void
  onColumns: () => void
  onPage: (delta: 1 | -1) => void
  /** Escape. Returns true when something was closed, which is what keeps a
   *  press that shuts a popover from also giving up the row cursor. */
  onDismiss: () => boolean
}

export interface EntriesKeyboardState {
  cursor: number | null
  setCursor: (index: number | null) => void
}

/**
 * The row cursor and the one key listener that drives it.
 *
 * The listener is registered once and reads its callbacks through a ref: they
 * are fresh closures on every render, and re-subscribing a window listener per
 * render for a page that re-renders on every response is a lot of churn for no
 * behaviour.
 */
export function useEntriesKeyboard(options: EntriesKeyboardOptions): EntriesKeyboardState {
  const [cursor, setCursor] = useState<number | null>(null)
  const latest = useRef(options)
  latest.current = options

  // A shorter page (a filter, the last page) must not leave the cursor past the
  // end. Adjusting during render is React's own answer to state derived from
  // props, and it keeps one render from pointing at a row that is not there.
  if (cursor !== null && cursor >= options.rowCount) setCursor(options.rowCount === 0 ? null : options.rowCount - 1)

  const cursorRef = useRef<number | null>(cursor)
  cursorRef.current = cursor

  useEffect(() => {
    const move = (delta: number) =>
      setCursor(() => {
        const count = latest.current.rowCount
        if (count === 0) return null
        const current = cursorRef.current
        if (current === null) return delta > 0 ? 0 : count - 1
        return Math.min(count - 1, Math.max(0, current + delta))
      })

    const run = (action: EntriesAction) => {
      const { rowCount, onOpen, onDelete, onNew, onFilter, onColumns, onPage, onDismiss } = latest.current
      const at = cursorRef.current
      switch (action) {
        case 'next-row': return move(1)
        case 'previous-row': return move(-1)
        case 'first-row': return rowCount > 0 && setCursor(0)
        case 'last-row': return rowCount > 0 && setCursor(rowCount - 1)
        case 'next-page': return onPage(1)
        case 'previous-page': return onPage(-1)
        case 'open': return at !== null && onOpen(at)
        case 'delete': return at !== null && onDelete(at)
        case 'new': return onNew()
        case 'filter': return onFilter()
        case 'columns': return onColumns()
        case 'dismiss':
          if (!onDismiss()) setCursor(null)
          return
      }
    }

    const onKey = (event: KeyboardEvent) => {
      if (!latest.current.active) return
      const action = EntriesShortcuts.actionFor(event, Keyboard.isTyping(event.target))
      if (!action) return
      // Only once it is ours: an unclaimed Backspace is the browser's back.
      event.preventDefault()
      run(action)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { cursor, setCursor }
}
