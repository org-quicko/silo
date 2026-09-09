import type { S3BlobStorageOptions } from "./s3-blob-storage";

/**
 * The URL an object in a bucket is publicly addressed by (D58).
 *
 * Split out of `S3BlobStorage` because it is the one thing about a bucket that
 * the *read* path outside silo needs and the port's five verbs never touch: a
 * media URL that names the bucket directly takes silo out of the read path
 * entirely, which is the only shape an email client can follow. Pure, so the
 * four addressing forms can be pinned without a bucket.
 *
 * The addressing has to agree with what the client is actually writing to, so
 * both are read off the same options — a root that guessed virtual-hosted
 * against a path-style gateway would hand out links that 404 while every
 * upload succeeded.
 */
export class S3PublicUrl {
  /**
   * Where the bucket's objects are rooted, with no trailing slash, or `null`
   * when nothing public can be pointed at — no bucket, an unreadable endpoint,
   * or a bucket the operator has turned `public_read` off for.
   *
   * A key is appended to this and nothing else, so a caller never learns which
   * of the four forms it got.
   */
  static rootOf(options: S3BlobStorageOptions): string | null {
    // **A configured bucket is a bucket meant to serve.** Moving a media
    // library off local disk and onto object storage is the decision to let the
    // store deliver; leaving silo in the read path afterwards is the unusual
    // case, so it is the one that gets a key. D59 briefly had this the other way
    // round and a configured bucket went on being proxied, which is not what
    // configuring it asked for.
    //
    // The key exists at all because readability is the one thing here that is
    // *not* derivable: it lives in a bucket policy silo never sees. So an
    // operator whose bucket is deliberately private turns it off and gets the
    // `/media/<id>` route, rather than being stuck with links that 403.
    if (options.publicRead === false) return null;
    if (!options.bucket) return null;
    const bucket = encodeURIComponent(options.bucket);
    const pathStyle = options.forcePathStyle ?? false;

    if ((options.endpoint ?? "").trim()) {
      // An endpoint was named, so AWS is not where this bucket is. One that
      // cannot be read answers `null` rather than falling through to the AWS
      // form, which would be a link at a host the objects are not on.
      const endpoint = S3PublicUrl.origin(options.endpoint);
      if (!endpoint) return null;
      return pathStyle
        ? `${endpoint.origin}/${bucket}`
        : `${endpoint.protocol}//${bucket}.${endpoint.host}`;
    }

    // AWS itself. `region` follows `S3BlobStorage`'s own default so the two
    // cannot disagree about which regional endpoint the bucket lives behind.
    const region = options.region || "us-east-1";
    return pathStyle
      ? `https://s3.${region}.amazonaws.com/${bucket}`
      : `https://${bucket}.s3.${region}.amazonaws.com`;
  }

  /**
   * A configured endpoint as a URL, or `null` when it names no host.
   *
   * An endpoint with no scheme is read as https rather than refused: it is the
   * form every provider's own documentation prints, and the alternative is a
   * bucket that stores bytes perfectly well and reports no public root.
   */
  private static origin(endpoint?: string): URL | null {
    const trimmed = (endpoint ?? "").trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      return parsed.host ? parsed : null;
    } catch {
      return null;
    }
  }
}
