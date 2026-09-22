import type { TrashKind } from "../../trash/trash-kind";

/** What the trash list can be narrowed by (D91). */
export interface TrashQuery {
  kind?: TrashKind;
  project?: string;
  env?: string;
  collection?: string;
  /** ISO 8601 bounds on `deleted_at`. */
  deleted_after?: string;
  deleted_before?: string;
  /** Case-insensitive substring of the subject's name. */
  q?: string;
  limit?: number;
  offset?: number;
}
