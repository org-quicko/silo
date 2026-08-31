/**
 * A folder move that is in flight — one `_media_folder_moves` document in
 * `Scope.System` (D49).
 *
 * A rename rewrites `path` on many folder records and `folder` on many asset
 * records, and no `Storage` adapter offers a transaction spanning them. So the
 * operation is staged the way a deletion is (D23): declare it, perform it,
 * clear the declaration. A process that dies mid-move leaves this record
 * behind, and `MediaFolderMoveService.resumePending` finishes the job at the
 * next start.
 *
 * The document id is a ULID, not the path: a path carries "/" and so is not a
 * safe path segment (§6.1), the same reason `MediaFolder` uses one.
 */
export interface MediaFolderMove {
  /** Normalised source path, as the caller gave it. */
  from: string;
  /** Normalised destination path. */
  to: string;
}
