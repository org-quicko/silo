import type { ConfigField } from "../config/config-field";
import type { SettingsOverride } from "./settings-override";

/**
 * One table of `silo.toml`, as the settings API reports it (D47).
 *
 * The same two-configuration shape `MediaStorageView` established: `file` is
 * what the form edits and `in_force` is what the process is actually running
 * on. They differ whenever a `SILO_*` variable or a flag outranks the file, and
 * a page that showed only one would let somebody save a value the instance then
 * ignores.
 */
export interface ConfigSectionView {
  table: string;
  title: string;
  summary: string;
  /** The spec, sent to the admin so a new setting appears on the page without
   *  the admin being taught about it separately. */
  fields: readonly ConfigField[];
  /** Only what the file names. A `[log]` setting `level` alone has not also
   *  decided the rotation policy. */
  file: Record<string, unknown>;
  in_force: Record<string, unknown>;
  overrides: SettingsOverride[];
  /** False for `[storage]`, which is reported and never written. */
  writable: boolean;
  /** Fields changed since this process started that are waiting for one. */
  restart_pending: string[];
}
