/** What a recursive folder delete into the trash did (D113). The route turns
 *  `failed` into the same per-id shape `POST /api/media/delete` answers. */
export interface MediaFolderTrashOutcome {
  deleted: string[];
  failed: Array<{ id: string; error: unknown }>;
  /** Zero when a file stayed, since the folder is then not gone. */
  foldersDeleted: number;
  /** The receipt, or null when the subtree held nothing to park. */
  trashId: string | null;
}
