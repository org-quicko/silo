export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastState {
  id: number
  message: string
  action?: ToastAction
}

/**
 * A single global snackbar, per the Material Design 3 guideline this follows:
 * "only one snackbar may be displayed at a time." Showing a new one replaces
 * whatever is on screen rather than queuing behind it — a stale confirmation
 * is never worth making a fresh one wait for.
 *
 * Without an action, it disappears on its own; with one, it stays up until
 * the action is taken (M3: "snackbars with actions should remain on the
 * screen until the user takes an action... or dismisses it").
 */
export class ToastManager {
  private static readonly DEFAULT_DURATION_MS = 4000

  private static current: ToastState | null = null
  private static timer: ReturnType<typeof setTimeout> | null = null
  private static seq = 0
  private static listeners = new Set<(toast: ToastState | null) => void>()

  public static show(message: string, options: { action?: ToastAction; durationMs?: number } = {}) {
    if (ToastManager.timer) clearTimeout(ToastManager.timer)
    const id = ++ToastManager.seq
    ToastManager.current = { id, message, action: options.action }
    ToastManager.emit()

    if (!options.action) {
      ToastManager.timer = setTimeout(() => ToastManager.dismiss(id), options.durationMs ?? ToastManager.DEFAULT_DURATION_MS)
    }
  }

  public static dismiss(id: number) {
    if (ToastManager.current?.id !== id) return
    ToastManager.current = null
    ToastManager.emit()
  }

  public static subscribe(listener: (toast: ToastState | null) => void): () => void {
    ToastManager.listeners.add(listener)
    listener(ToastManager.current)
    return () => ToastManager.listeners.delete(listener)
  }

  private static emit() {
    for (const listener of ToastManager.listeners) listener(ToastManager.current)
  }
}
