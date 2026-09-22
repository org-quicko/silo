/**
 * The header a delete carries its trash receipt's id in (D91), and the reader
 * for it.
 *
 * Absent when the delete was permanent or the instance has the trash off, so
 * every reader treats a miss as "this is not recoverable" rather than an error.
 */
export class TrashHeader {
  static readonly Name = "X-Silo-Trash-Id";

  static read(headers: Headers): string | null {
    return headers.get(TrashHeader.Name) || null;
  }
}
