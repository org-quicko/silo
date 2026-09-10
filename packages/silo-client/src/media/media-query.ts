/**
 * `Media.list()`'s search, in client-facing names. `Media` translates these
 * onto the wire's `q`, `ext`, `modified_after` and `modified_before` — the
 * same rule the response mapper follows, applied to a request instead.
 */
export interface MediaQuery {
  /** Substring match on the filename; the wire's `q`. */
  text?: string;
  /** Exact folder, or every folder beneath it when `recursive` is set. */
  folder?: string;
  recursive?: boolean;
  /** Substring match on the content type, e.g. "image/" or "pdf". */
  type?: string;
  /** Exact file extension, no dot; the wire's `ext`. */
  extension?: string;
  tag?: string;
  /** Inclusive ISO-8601 bounds on `updated_at`. */
  modifiedAfter?: string;
  modifiedBefore?: string;
  limit?: number;
  offset?: number;
  /** "-created_at" (default), "created_at", "filename", "-filename", "size", "-size". */
  sort?: string;
}
