import type { MediaStorageFacts } from "./media-storage-facts";
import type { SettingsOverride } from "./settings-override";

/**
 * Where the media library keeps its bytes, as `GET /api/media/storage` reports
 * it (D45).
 *
 * **Two configurations, not one**, and the split is the whole design. The page
 * edits a *file*, and a file is the third thing consulted: flags outrank
 * `SILO_*` env vars, which outrank it (§10). A view that reported only what is
 * in force would put a derived value into a form — the fs media path is
 * `<data dir>/media` precisely while nobody has named one, so saving it back
 * would pin media in place and quietly break `--data`, which is the failure
 * `ConfigScaffold` writes that key out commented to avoid.
 *
 * So `file` is what the form holds and writes, `in_force` is what the instance
 * is doing, and `overrides` names every field where the two differ for a reason
 * the operator needs to know about.
 */
export interface MediaStorageView {
  /** The `[blob_storage]` table as `silo.toml` holds it. Defaults when the file
   *  has no such table, which is what the loader would use too. */
  file: MediaStorageFacts;
  /** The same, after env vars, flags and the fs-path derivation. */
  in_force: MediaStorageFacts;
  /** Every blob driver this process can open, plugin-contributed ones included
   *  (D31/§13.7) — so the provider list is what this build actually has rather
   *  than a copy of it in the UI. */
  drivers: string[];
  overrides: SettingsOverride[];
  /** Where a save lands. Absent when this process was handed no config file, in
   *  which case there is nothing to write and `writable` says so. */
  config_path?: string;
  writable: boolean;
  /** Why a save cannot land, when one cannot: no file to write, or a path this
   *  server has no write access to. The admin prints it as it stands. */
  read_only_reason?: string;
}
