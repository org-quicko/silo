import { api } from '../../api/silo-api'
import { ToastManager } from '../../utils/toast-manager'

/**
 * The toast a delete leaves behind (D91).
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
  ): void {
    if (!trashId) {
      ToastManager.show(`Deleted ${subject}.`)
      return
    }

    ToastManager.show(`Moved ${subject} to trash.`, {
      action: {
        label: 'Undo',
        onClick: () => {
          void api.trash
            .restore(url, apiKey, trashId)
            .then(() => {
              ToastManager.show(`Restored ${subject}.`)
              onRestored()
            })
            .catch((caught: unknown) => {
              ToastManager.show(
                caught instanceof Error ? caught.message : `Could not restore ${subject}.`,
              )
            })
        },
      },
    })
  }
}
