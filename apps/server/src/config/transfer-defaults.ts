/** The transfer ceilings a file does not name (D85). */
export class TransferDefaults {
  /**
   * Eight times the listener's default body ceiling: an upload never reaches
   * it, and a copy of an instance whose export is larger than this is one an
   * operator raises the setting for on purpose.
   */
  static readonly MaxArchiveSizeMb = 1024;

  /**
   * Four times the archive ceiling. Media does not compress, so a real archive
   * expands to little more than itself plus its JSON; a gzip bomb expands a
   * thousandfold, and this is where it stops.
   */
  static readonly MaxExtractedSizeMb = 4096;

  /** A size in megabytes, or the fallback when the value is not a positive
   *  number. There is no "unlimited": zero and below name no bound at all. */
  static sizeMb(megabytes: number, fallback: number): number {
    if (!Number.isFinite(megabytes) || megabytes <= 0) return fallback;
    return megabytes;
  }

  static bytes(megabytes: number): number {
    return Math.ceil(megabytes * 1024 * 1024);
  }
}
