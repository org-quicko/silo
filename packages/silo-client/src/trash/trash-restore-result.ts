/** What a restore put back, and what it could not fix. */
export interface TrashRestoreResult {
  /** Receipt ids restored, containers first when a chain was asked for. */
  restored: string[];
  projects: number;
  environments: number;
  collections: number;
  entries: number;
  assets: number;
  /** Media the content still names that the library no longer holds. */
  broken_media_refs: string[];
  /** The name the subject came back under, when a collision forced a rename. */
  renamed_to?: string;
}
