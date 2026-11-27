export interface SaveKeyPress {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
}

/** Matches `⌘S` / `Ctrl+S` without extra modifiers or key auto-repeat. */
export class SaveShortcut {
  static matches(press: SaveKeyPress): boolean {
    if (press.repeat) return false
    if (!(press.metaKey || press.ctrlKey)) return false
    if (press.altKey || press.shiftKey) return false
    return press.key.toLowerCase() === 's'
  }
}
