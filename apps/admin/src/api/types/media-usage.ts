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
 * `visible_count` is the true count of referrers the current key may read —
 * not how many fit on the `referrers` page below, which can be smaller.
 * `visible_capped` is set instead of a silently truncated `visible_count`
 * once there are too many referrers to enumerate exactly (§8.1).
 */
export interface MediaInUse {
  usage_count: number
  visible_count: number
  visible_capped: boolean
  referrers: MediaUsage[]
}
