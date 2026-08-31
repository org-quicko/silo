/**
 * One setting, described once (D47).
 *
 * `[blob_storage]` and `[media]` each got a hand-written reader, writer and
 * override reporter, and that was affordable twice. For the four tables left it
 * would be twelve near-identical files whose only real content is *which TOML
 * key carries which value and which `SILO_*` variable beats it* — and the
 * failure mode of writing that out by hand is a field appearing in the form and
 * in the writer while nothing reports the variable quietly winning over both.
 * So it is stated once here and everything else reads it.
 *
 * The admin's labels live here too, rather than in the admin. A settings page
 * that has to be edited in two repositories to add a field is how a field ends
 * up saved but never shown.
 */
export interface ConfigField {
  /** The TOML key, which is also how the API spells the field. */
  key: string;
  type: "string" | "boolean" | "number" | "enum";
  /** For `enum`: every accepted value, in the order the admin should offer them. */
  values?: readonly string[];
  /** The `SILO_*` variable that outranks the file for this field (§10). */
  env?: string;
  /**
   * Whether a change only takes effect at the next start.
   *
   * Stated per field rather than per table because the same table has both:
   * `[log] level` is a threshold read on every line, while `[log] file` is a
   * sink opened once at boot. Saying "restart the server" for the first would
   * be a lie an operator would believe.
   */
  restart?: boolean;
  /**
   * Shown, never written. For settings whose value the API has no business
   * changing — `[storage]`, which is the instance itself, not a preference
   * about it — and which are here so the page can report them honestly rather
   * than pretend they do not exist.
   */
  readOnly?: boolean;
  label: string;
  help?: string;
  /** Numbers only: the smallest accepted value. */
  min?: number;
  /** Numbers only: `0` means "off" rather than "the smallest allowed", which
   *  the form has to say out loud for rotation and the scan budget. */
  zeroMeans?: string;
}
