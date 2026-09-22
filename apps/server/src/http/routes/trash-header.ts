/**
 * The response header a delete carries its trash receipt's id in (D91).
 *
 * A header rather than a body so a 204 stays a 204: the admin needs the id to
 * offer an undo, and a client that has never heard of the trash sees exactly
 * the response it always saw. Absent when the delete was permanent or the trash
 * is off.
 */
export class TrashHeader {
  static readonly Name = "X-Silo-Trash-Id";
}
