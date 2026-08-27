/** One entry's reference to one media asset (D23). */
export interface MediaUsage {
  /** The asset's catalog id, or `blob:<key>` for a pre-D23 reference. */
  media_id: string;
  project: string;
  env: string;
  collection: string;
  entry_id: string;
}
