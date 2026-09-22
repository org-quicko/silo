import type { AuditActor } from "../audit/audit-actor";
import type { TrashContents } from "./trash-contents";
import type { TrashKind } from "./trash-kind";
import type { TrashOrigin } from "./trash-origin";

/**
 * How far along a trash, restore or purge got. Staged the way a media delete
 * (D23) and a folder move (D49) are, because no adapter offers a transaction
 * spanning this many records. Anything not `parked` is resumed at startup.
 */
export type TrashState = "parking" | "parked" | "restoring" | "purging";

/**
 * One explicitly deleted thing — a `_trash` document in `Scope.System` (D91).
 *
 * Only the *explicitly* deleted thing gets one. A collection deleted with 300
 * entries under it produces one receipt, not 301: the same rule the
 * FreeDesktop trash spec states for directories and Google Drive states with
 * `explicitlyTrashed`. See `docs/design/trash.md`.
 */
export interface TrashReceipt {
  kind: TrashKind;
  origin: TrashOrigin;
  /** Preserved, so a restore keeps every reference and URL that pointed here. */
  subject_id: string;
  subject_name: string;
  deleted_at: string;
  deleted_by: AuditActor;
  /** Null when retention is off. */
  expires_at: string | null;
  contents: TrashContents;
  /**
   * Media the parked content referenced. Those rows left `media_references`
   * with the entry, so an asset can be deleted while the only thing naming it
   * sits in the trash; a restore cannot prevent that, only report it.
   */
  media_refs: string[];
  state: TrashState;
}
