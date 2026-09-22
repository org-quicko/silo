/** What `[trash]` means when a file does not say (D91). */
export class TrashDefaults {
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
}
