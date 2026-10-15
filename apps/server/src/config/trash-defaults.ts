/** What `[trash]` means when a file does not say (D113). */
export class TrashDefaults {
  /** On, so an instance upgraded with an older `silo.toml` keeps deletes recoverable. */
  static readonly Enabled = true;

  /** Thirty days, the window Drive, Dropbox and Figma all settled on. Long
   *  enough that a mistake is noticed, short enough that the disk recovers. */
  static readonly RetentionDays = 30;

  /** How often the sweeper looks. Retention is measured in days, so an hour
   *  is fine grained and costs one filtered list. */
  static readonly SweepIntervalMs = 60 * 60 * 1000;

  /** A day count, or the fallback when the value is not a whole number at or
   *  above zero. Zero is meaningful: keep until purged by hand. */
  static days(value: number, fallback: number): number {
    if (!Number.isFinite(value) || value < 0) return fallback;
    return Math.floor(value);
  }

  /**
   * `SILO_TRASH_ENABLED`: `true` or `false` in any case. Anything else throws,
   * because reading it as off would make deletes permanent on a typo, and
   * reading it as on would ignore an operator who meant off.
   */
  static parseEnabled(raw: string): boolean {
    const value = raw.trim().toLowerCase();
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`config: SILO_TRASH_ENABLED must be "true" or "false", not "${raw}"`);
  }
}
