/**
 * The wire's error body: `{"error": {"code", "message", "details"}}`.
 * `details` is left as `unknown` here because its shape is code-specific — an
 * array for `validation_failed`, an object for `media_in_use` and
 * `media_delete_stalled`, absent otherwise.
 */
export interface ErrorPayload {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
