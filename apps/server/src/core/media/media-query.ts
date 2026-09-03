/**
 * The search a media listing runs (D23). Every field maps onto the existing
 * Query AST over `_media` — `contains` on `filename`, `eq` on `folder`,
 * `contains` on `content_type` and `tags` — so media search adds no operator
 * that every storage adapter would then have to support forever (§5.3).
 */
export interface MediaQuery {
  /** Substring match on the display filename; the `?q=` parameter. */
  text?: string;
  /** Exact folder, or every folder beneath it when `recursive` is set. */
  folder?: string;
  recursive?: boolean;
  /** Substring match on the content type, e.g. "image/" or "pdf". */
  type?: string;
  /** Exact file extension, no dot, e.g. "png" or "pdf" — one of
   *  `MediaService.listExtensions()`'s own values (D55). */
  ext?: string;
  tag?: string;
  /** Inclusive ISO-8601 bounds on `updated_at` (D55). Lexicographic string
   *  comparison over ISO-8601 timestamps already orders chronologically, so
   *  this needs no operator beyond the `gte`/`lte` every numeric range in the
   *  admin already uses. */
  modifiedAfter?: string;
  modifiedBefore?: string;
  limit?: number;
  offset?: number;
  /** "-created_at" (default), "created_at", "filename", "-filename", "size", "-size". */
  sort?: string;
}
