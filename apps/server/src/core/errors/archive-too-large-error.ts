/** An archive, or the tree it expands to, is past the instance's ceiling
 *  (`[transfer]`, D85): HTTP 413, code `archive_too_large`. */
export class ArchiveTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveTooLargeError";
  }
}
