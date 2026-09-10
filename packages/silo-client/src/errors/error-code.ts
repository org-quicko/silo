/** The wire's `error.code` values this client maps to a class. An
 *  unrecognised string still arrives as `string` from the wire; `ErrorFactory`
 *  falls back to HTTP status when it sees one. */
export type ErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "media_in_use"
  | "media_delete_stalled"
  | "internal";
