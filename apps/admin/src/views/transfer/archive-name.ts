/**
 * What an export downloads as.
 *
 * Its own file because two places need the same answer: the anchor the export
 * click builds, and the row on the Export tab that tells you the name before
 * you click it. Dated rather than timestamped — a second export the same day
 * lands beside the first as `(1)`, which is what a browser does with any
 * repeated download and is more use than a filename nobody can read.
 */
export class ArchiveName {
  static of(on = new Date()): string {
    return `silo-export-${on.toISOString().slice(0, 10)}.tar.gz`
  }
}
