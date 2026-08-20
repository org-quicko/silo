/**
 * A folder that exists because someone made it — one `_media_folders`
 * document in `Scope.System` (D23).
 *
 * Folders follow D20's existence rule in both halves: this record is the
 * explicit half, and an asset naming a folder is the derived half. The
 * explicit half is what lets a folder be created before anything is filed
 * into it. The document id is a ULID rather than the path itself because a
 * path carries "/" and so is not a safe path segment (§6.1).
 */
export interface MediaFolder {
  /** Normalised "/a/b"; never "" (the root needs no record). */
  path: string;
}
