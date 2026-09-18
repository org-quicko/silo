/**
 * What an export downloads as.
 *
 * Its own file because two places need the same answer: the anchor the export
 * click builds, and the row on the Export tab that tells you the name before
 * you click it.
 *
 * Stamped to the second and in **UTC**, so a directory of archives sorts into
 * the order they were taken and two exports on one day do not collide into the
 * browser's `(1)`. The instant is the ISO 8601 one with the separators a
 * filename cannot carry removed, which keeps it readable as a date and still
 * lexically sortable.
 */
export class ArchiveName {
  static of(on = new Date()): string {
    return `silo-export-${ArchiveName.stamp(on)}.tar.gz`
  }

  /** `20260917T061258Z` — ISO 8601 basic format, which is the same instant
   *  without the `-` and `:` a filename should not hold. */
  static stamp(on: Date): string {
    return on.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  }

  /**
   * The name as the Export tab states it before the click.
   *
   * The shape rather than an instant, because the download stamps the moment it
   * happens: a row holding a specific second would be wrong for every visitor
   * who read it and then thought about it.
   */
  static readonly Pattern = 'silo-export-<UTC timestamp>.tar.gz'
}
