/**
 * One entry's reference to a media asset, mapped from the wire's snake_case
 * (`media_id`, `env`, `entry_id`) by `MediaAssetMapper`. The one
 * referrer type across the client — `MediaUsagePage` and `MediaInUseError`
 * both use this rather than each declaring their own.
 */
export interface MediaUsage {
  mediaId: string;
  project: string;
  environment: string;
  collection: string;
  entryId: string;
}
