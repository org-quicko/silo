/**
 * The search a media listing runs (D23). Every field maps onto the existing
 * Query AST over `_media` — `contains` on `filename`, `eq` on `folder`,
 * `contains` on `content_type` and `tags` — so media search adds no operator
 * that every storage adapter would then have to support forever (§5.3).
 */
export interface MediaQuery {
  /** Substring match on the display filename. */
  q?: string;
  /** Exact folder, or every folder beneath it when `recursive` is set. */
  folder?: string;
  recursive?: boolean;
  /** Substring match on the content type, e.g. "image/" or "pdf". */
  type?: string;
  tag?: string;
  limit?: number;
  offset?: number;
  /** "-created_at" (default), "created_at", "filename", "-filename", "size", "-size". */
  sort?: string;
}
