/** What a restore put back, and what it could not fix (D91). */
export interface TrashRestoreResult {
  restored: string[]
  projects: number
  environments: number
  collections: number
  entries: number
  assets: number
  /** Media the content still names that the library no longer holds. */
  broken_media_refs: string[]
  renamed_to?: string
}
