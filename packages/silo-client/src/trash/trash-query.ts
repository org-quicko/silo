import type { TrashKind } from "./trash-record.js";

/** How the trash list is narrowed. All optional; the default is everything
 *  this key may see, newest first. */
export interface TrashQuery {
  kind?: TrashKind;
  project?: string;
  env?: string;
  collection?: string;
  /** ISO 8601 bounds on when the thing was deleted. */
  deletedAfter?: string;
  deletedBefore?: string;
  /** Case-insensitive substring of the subject's name. */
  q?: string;
  limit?: number;
  offset?: number;
}
