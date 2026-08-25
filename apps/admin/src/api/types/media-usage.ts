/** One entry that references a media asset (D23). */
export interface MediaUsage {
  media_id: string
  project: string
  env: string
  collection: string
  entry_id: string
}

/**
 * The body of a refused media delete. `usage_count` is the true total;
 * `referrers` holds only those the current key may read, so a project-scoped
 * key sees that a file is in use without seeing where (§8.1).
 */
export interface MediaInUse {
  usage_count: number
  visible_count: number
  referrers: MediaUsage[]
}
