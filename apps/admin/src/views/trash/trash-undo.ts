import { api } from '../../api/silo-api'
import { store } from '../../store/store'
import { ToastManager, type ToastAction } from '../../utils/toast-manager'

/**
 * The toast a delete leaves behind (D113).
 *
 * Most mistakes are noticed within seconds, so undo belongs where the user
 * already is rather than behind a trip to the trash page. `ToastManager` keeps
 * a toast with an action on screen until it is acted on, which is exactly the
 * behaviour an undo wants.
 *
 * A null `trashId` means nothing was kept — the delete was permanent, or the
 * instance runs with the trash off — so the toast states the outcome and offers
 * nothing it cannot deliver.
 */
export class TrashUndo {
  static offer(
    trashId: string | null,
    subject: string,
    url: string,
    apiKey: string,
    onRestored: () => void,
    dependencies?: {
      restore?: (url: string, apiKey: string, trashId: string) => Promise<unknown>
      sessionEpoch?: () => number
      showToast?: (message: string, options?: { action?: ToastAction; durationMs?: number }) => void
    },
  ): void {
    const showToast =
      dependencies?.showToast ?? ((message, options) => ToastManager.show(message, options))
    if (!trashId) {
      showToast(`Deleted ${subject}.`)
      return
    }

    const restore =
      dependencies?.restore ?? ((targetUrl, key, id) => api.trash.restore(targetUrl, key, id))
    const currentEpoch = dependencies?.sessionEpoch ?? (() => store.sessionEpoch())
    const epochAtOffer = currentEpoch()

    showToast(`Moved ${subject} to trash.`, {
      action: {
        label: 'Undo',
        onClick: () => {
          if (currentEpoch() !== epochAtOffer) {
            showToast('Session changed — undo skipped.')
            return
          }
          void restore(url, apiKey, trashId)
            .then(() => {
              if (currentEpoch() !== epochAtOffer) return
              showToast(`Restored ${subject}.`)
              onRestored()
            })
            .catch((caught: unknown) => {
              if (currentEpoch() !== epochAtOffer) return
              showToast(
                caught instanceof Error ? caught.message : `Could not restore ${subject}.`,
              )
            })
        },
      },
    })
  }
}
