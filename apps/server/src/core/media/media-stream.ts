import type { BlobRange } from "../ports/blob-storage";

/**
 * An asset opened for delivery: a body that is read as it is sent, plus the
 * headers a response needs.
 *
 * `body` is a stream from the built-in stores — a file read from disk or an
 * object fetched from a bucket as it is sent — or a `Blob` from a store that
 * only has one, which the route streams rather than hands to the response.
 * `size` is the whole object, known from the catalog or a `stat`, and `range`
 * is the span this body carries when the request asked for one.
 */
export interface MediaStream {
  body: Blob | ReadableStream<Uint8Array>;
  contentType: string;
  size?: number;
  range?: BlobRange;
  filename?: string;
  hash?: string;
}
