import type { ConfigField } from "./config-field";

/** One `[table]` of `silo.toml`, and what the settings API may do with it. */
export interface ConfigSection {
  /** The TOML table name, which is also the path segment: `/api/settings/log`. */
  table: string;
  title: string;
  /** One line, for the card header. The reasoning belongs in `docs/`. */
  summary: string;
  fields: readonly ConfigField[];
  /**
   * Written by the API at all.
   *
   * `[storage]` is the one that is not: changing the driver or the data
   * directory does not configure this instance, it points the next start at a
   * **different** one, and an operator who did that from a browser would watch
   * their content disappear on the next restart with the file saying it was
   * their own doing. It is reported and left alone.
   */
  writable: boolean;
  /**
   * A save may only move this table's values *towards* the safer setting.
   *
   * One table has it: `[auth]`. An API that can switch off the authentication
   * protecting it is a lock whose key opens itself, so `disabled` may be set to
   * `false` and never to `true` — which still leaves the useful direction open,
   * since an instance running with auth off is one where anybody can already do
   * anything and turning it back on is the repair.
   */
  tightenOnly?: boolean;
}
