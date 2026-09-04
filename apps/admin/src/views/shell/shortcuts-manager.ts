/**
 * Whether the shell's keyboard-shortcut list is open, as a global pub-sub —
 * the same shape `ToastManager` uses, for the same reason: the trigger (the
 * header button, the `?` key) and the renderer (`ShortcutsHost`, mounted once
 * in `App.tsx`) are nowhere near each other in the tree, and every page
 * renders its own `TopBar` instance rather than sharing one.
 */
export class ShortcutsManager {
  private static open = false
  private static listeners = new Set<(open: boolean) => void>()

  static show() {
    ShortcutsManager.open = true
    ShortcutsManager.emit()
  }

  static hide() {
    ShortcutsManager.open = false
    ShortcutsManager.emit()
  }

  static subscribe(listener: (open: boolean) => void): () => void {
    ShortcutsManager.listeners.add(listener)
    listener(ShortcutsManager.open)
    return () => ShortcutsManager.listeners.delete(listener)
  }

  private static emit() {
    for (const listener of ShortcutsManager.listeners) listener(ShortcutsManager.open)
  }
}
