import type { TrashKind } from "./trash-kind";
import type { TrashReceipt } from "./trash-receipt";

/**
 * Why a receipt cannot be restored yet: the container it came from is gone.
 *
 * `trash_id` names the receipt that would unblock it when the container is
 * itself in the trash, which is what the admin's "Restore both" acts on. Null
 * means the container was purged, so the only way back is a destination the
 * caller picks.
 */
export interface TrashBlocker {
  kind: TrashKind;
  name: string;
  trash_id: string | null;
}

/** A receipt as the API returns it. */
export interface TrashView extends TrashReceipt {
  id: string;
  /** False when `blocked_by` is set, so a client need not re-derive it. */
  restorable: boolean;
  blocked_by?: TrashBlocker;
}
