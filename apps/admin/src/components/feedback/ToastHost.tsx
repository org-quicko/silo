import { useEffect, useState } from 'react'
import { ToastManager, type ToastState } from '../../utils/toast-manager'
import styles from './Toast.module.css'

/**
 * Mounted once, near the app root — every `ToastManager.show(...)` call
 * anywhere in the admin surfaces here, at a fixed spot at the bottom of the
 * screen, in front of content but never in front of the sidebar nav.
 */
export function ToastHost() {
  const [toast, setToast] = useState<ToastState | null>(null)

  useEffect(() => ToastManager.subscribe(setToast), [])

  if (!toast) return null

  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <span className={styles.message}>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.action!.onClick()
            ToastManager.dismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
