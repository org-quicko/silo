import type { MediaConfig } from "../config/media-config";
import type { SettingsOverride } from "./settings-override";

/**
 * What `GET /api/media/settings` returns (D46).
 *
 * The same two-configuration shape as `MediaStorageView`, and for the same
 * reason: `file` is what the form edits and `in_force` is what this process is
 * actually resolving URLs and refusing uploads with. They differ whenever a
 * `SILO_MEDIA_*` variable outranks the file.
 */
export interface MediaPolicyView {
  /** What the file names, and only that — a `[media]` that sets `base_url`
   *  alone must not read as one that also reset the extension list. */
  file: Partial<MediaConfig>;
  in_force: MediaConfig;
  overrides: SettingsOverride[];
  /** What a new instance would start with, so the page can offer it back after
   *  someone has emptied the list. */
  default_extensions: string[];
  config_path?: string;
  writable: boolean;
  /** Why a save cannot land, when one cannot. See `MediaStorageView`. */
  read_only_reason?: string;
}
