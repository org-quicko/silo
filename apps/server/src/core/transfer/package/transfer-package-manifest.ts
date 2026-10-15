import type { MediaMode } from "../media-mode";

/**
 * `package.json`, written last so every number in it counts what the package
 * actually carries (D108). `collections` echoes the selection it was cut to.
 */
export interface TransferPackageManifest {
  package_version: number;
  silo_version: string;
  instance_id: string;
  created_at: string;
  scope: { project: string; env: string };
  media: MediaMode;
  collections: { name: string; entry_ids?: string[]; entries: number }[];
  /** Catalog rows and folder records carried; zero with `media: none`. */
  media_assets: number;
  media_folders: number;
  /** References the carried entries hold that the source has no active asset for. */
  missing_media: string[];
}
