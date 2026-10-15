/**
 * What a verified package holds (D109), as a prepared transfer records it.
 *
 * Every number was counted from the package's own files and matched against
 * its `package.json`, so the summary and the files cannot disagree.
 */
export interface TransferPackageSummary {
  created_at: string;
  silo_version: string;
  instance_id: string;
  collections: { name: string; entries: number }[];
  media_assets: number;
  media_folders: number;
  /** References the packaged entries hold that the source had no asset for. */
  missing_media: string[];
}
