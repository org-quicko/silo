/**
 * One field of a settings page's config that `silo.toml` does not decide
 * (D45, shared with `[media]` by D46).
 *
 * The page exists to edit a file, and a file is the *third* thing consulted:
 * flags outrank `SILO_*` env vars, which outrank it (§10). Reporting the
 * override is therefore not a nicety — without it, an operator would type a
 * bucket into a form, watch it save, and see the instance keep using another
 * one, with the UI agreeing with neither.
 */
export interface SettingsOverride {
  /** The field as this API spells it: `bucket`, `path`, `access_key_id`, … */
  field: string;
  /**
   * The variable in force, when one is — the only source that can be named
   * exactly, since it is read here in the same process.
   *
   * Absent means something else supplies the field: a flag (`--blob-path` is
   * the only one today), or a `silo.toml` edited by hand since this process
   * started. Both have the same consequence for a reader, which is why they are
   * not guessed apart: the value in the file is not the value in use, and
   * `in_force` is what is.
   */
  env?: string;
}
