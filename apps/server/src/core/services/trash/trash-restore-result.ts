/** What a restore put back, and what it could not fix (D91). */
export interface TrashRestoreResult {
  /** Receipt ids restored, ancestors first when the caller asked for a chain. */
  restored: string[];
  projects: number;
  environments: number;
  collections: number;
  entries: number;
  assets: number;
  /**
   * Media ids the content still names that the library no longer holds.
   *
   * The references left `media_references` when the content did, so an asset
   * could be deleted while the only thing naming it sat in the trash. Reported
   * rather than repaired: restoring an entry with a dead image and saying
   * nothing is worse than restoring it and saying so.
   */
  broken_media_refs: string[];
  /** The name the subject came back under, when a collision forced a rename. */
  renamed_to?: string;
}
