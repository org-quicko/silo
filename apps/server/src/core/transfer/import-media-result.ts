/** What an import did about the archive's media bytes. */
export interface ImportMediaResult {
  /** Blobs written into the destination library. `0` on a dry run, and on any
   *  import run with `media: none`. */
  files: number;
  /**
   * Whether the destination library was emptied before loading. True only for
   * a replace of a whole-library archive — a partial one is not authoritative
   * for blobs it never carried (§7.7).
   */
  cleared: boolean;
}
