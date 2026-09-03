import { useEffect, useState } from 'react'
import { ShortcutsDialog } from './ShortcutsDialog'
import { ShortcutsManager } from './shortcuts-manager'

/** Mounted once, near the app root — the header button on every page and the
 *  `?` key both go through `ShortcutsManager` rather than a prop threaded
 *  into however many `TopBar` call sites there are. */
export function ShortcutsHost() {
  const [open, setOpen] = useState(false)

  useEffect(() => ShortcutsManager.subscribe(setOpen), [])

  if (!open) return null

  return <ShortcutsDialog onClose={ShortcutsManager.hide} />
}
