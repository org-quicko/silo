/**
 * One field-level validation failure. JSON Pointer path plus a message, exactly
 * as it appears in an API error body's `error.details`, so the server, the wire
 * format, and the admin UI's form-error mapping all describe it once.
 */
export interface ValidationDetail {
  path: string;
  message: string;
}
