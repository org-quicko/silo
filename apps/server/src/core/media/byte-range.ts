import type { BlobRange } from "../ports/blob-storage";

/** What a `Range` header asked for, before the object's size is known. */
export type ByteRangeRequest =
  | { kind: "from"; start: number; end?: number }
  | { kind: "suffix"; length: number };

/**
 * One `Range: bytes=...` request, parsed and then resolved against a size
 * (RFC 9110 §14). Only a single range is honoured; anything else — several
 * ranges, another unit, a malformed value — is read as "no range", which the
 * RFC permits a server to do and which answers the whole object with a 200.
 */
export class ByteRange {
  private static readonly Single = /^bytes=(\d*)-(\d*)$/;

  static parse(header: string | undefined | null): ByteRangeRequest | null {
    if (!header) return null;
    const match = ByteRange.Single.exec(header.trim());
    if (!match) return null;
    const [, first, last] = match;
    if (first === "" && last === "") return null;
    if (first === "") return { kind: "suffix", length: Number(last) };
    const start = Number(first);
    if (last === "") return { kind: "from", start };
    const end = Number(last);
    if (end < start) return null;
    return { kind: "from", start, end };
  }

  /**
   * The inclusive span to serve, clamped to the object, or `null` when nothing
   * in the request lies inside it — the `416` case. A suffix longer than the
   * object is the whole object; an end past it is clamped, as the RFC says.
   */
  static resolve(request: ByteRangeRequest, size: number): BlobRange | null {
    if (size <= 0) return null;
    if (request.kind === "suffix") {
      if (request.length <= 0) return null;
      return { start: Math.max(0, size - request.length), end: size - 1 };
    }
    if (request.start >= size) return null;
    const end = request.end === undefined ? size - 1 : Math.min(request.end, size - 1);
    return { start: request.start, end };
  }
}
