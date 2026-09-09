import { MediaRef } from "@silo/shared/media-ref";
import type { MediaConfig } from "../../config/media-config";

/**
 * Turning a stored media reference into a URL a client can fetch (D46, D48,
 * D58).
 *
 * One object rather than a `baseUrl` string, because there are three facts in
 * the answer and not one: where URLs are rooted, whether the bytes are served
 * by silo or straight out of the object store, and — only in the second case —
 * which blob key each asset holds. Passing them separately would put the
 * decision at every call site instead of here, and D58 exists because they had
 * drifted: the same asset was a bucket URL in one response and a relative path
 * in another.
 *
 * **Two shapes, and `base_url` alone decides which** (D58, settled in D60):
 *
 * - **`base_url` is set**: `<base_url>/media/<id>`. The base names silo — a
 *   proxy, a custom domain, a path prefix in front of it — so it takes silo's
 *   own route, whatever the store is. Whatever domain and path an operator
 *   gives, `/media/<id>` is appended to it.
 * - **It is not, and the store is publicly addressable** (a bucket serving
 *   anonymous reads): `<bucket root>/<blob key>`. Silo leaves the read path
 *   entirely and the object is addressed the way S3 addresses it. This is the
 *   only shape that is not `/media/<id>`.
 * - **Neither**: `<request origin>/media/<id>`. Silo streams the bytes.
 *
 * D58 had `base_url` swap the *host* while the store kept deciding the *path*,
 * so a base pointing at silo — the ordinary case, since that is what a custom
 * domain is for — produced `<base>/<blob key>`: a well-formed URL for a path
 * silo does not serve. Pinning the base to silo's route is what makes it always
 * resolve, and the cost is that a CDN in front of the *bucket* is no longer
 * expressible through `base_url`; a CDN in front of *silo* still is.
 *
 * A reference resolves to one of three states, not two. **Not asked** — the id
 * was never looked up (`fromRequest`, or an id past `MediaLinkResolver`'s cap)
 * — resolves without a blob key, which is the one case a bucket-backed
 * instance falls back to silo's own origin. **Asked and present** is a URL.
 * **Asked and absent** is `null`: the catalog was consulted and the id is gone,
 * most often a force-delete (D48). `keys` says which ids were found; `asked`
 * says which were looked up at all — the difference between the two is "asked
 * and absent", so the two are kept apart rather than folding "not found" into
 * an empty `keys` entry, which cannot be told apart from "never checked".
 *
 * Deliberately **synchronous**. `EntryUtils.toApiResponse` is a pure function
 * and every route calls it inside a `map`, so anything this needs from storage
 * is resolved before it is built (`MediaService.links` / `MediaLinkResolver`),
 * never from inside it.
 */
export class MediaLinks {
  /** Where the request itself reached this instance. Always serviceable, which
   *  is what makes it the fallback when nothing else can answer. */
  private readonly origin: string;
  /** `[media] base_url`, or empty. */
  private readonly base: string;
  /** The blob store's own public URL root, or empty when silo serves the
   *  bytes. See `BlobStorage.publicRoot`. */
  private readonly store: string;
  /** Asset id to blob key, for every id that was looked up and found. */
  private readonly keys: Map<string, string>;
  /** Every id that was looked up at all, found or not (D48). */
  private readonly asked: Set<string>;

  private constructor(
    origin: string,
    base: string,
    store: string,
    keys: Map<string, string>,
    asked: Set<string>
  ) {
    this.origin = MediaLinks.trim(origin);
    this.base = MediaLinks.trim(base);
    this.store = MediaLinks.trim(store);
    this.keys = keys;
    this.asked = asked;
  }

  /** No `[media]` and no bucket: URLs are rooted at the request, addressed by
   *  id, and nothing was ever asked about. What a test wants. */
  static fromRequest(requestBase: string): MediaLinks {
    return new MediaLinks(requestBase, "", "", new Map(), new Set());
  }

  /**
   * The configured answer.
   *
   * `storeRoot` is what the running blob store says it is, so an instance
   * repointed from a directory to a bucket changes every URL it hands out at
   * the same moment it changes where the bytes go — the two were never
   * separate decisions, and D58 stopped pretending they were.
   *
   * `keys` and `asked` default to empty, which is "nothing was looked up" —
   * the same as before D48 — for every caller that does not pass them.
   */
  static of(
    config: MediaConfig,
    storeRoot: string,
    requestBase: string,
    keys?: Map<string, string>,
    asked?: Set<string>
  ): MediaLinks {
    return new MediaLinks(
      requestBase,
      config.base_url || "",
      storeRoot,
      keys ?? new Map(),
      asked ?? new Set()
    );
  }

  /**
   * One stored value as a URL, or `null` if it named an asset that was asked
   * about and is gone (D48).
   *
   * An absolute URL is already an answer and is passed through untouched.
   * A pre-D23 `/media/<blobKey>` still resolves, so an instance serves
   * correctly while it is being backfilled — and on a bucket it resolves
   * *better* than a catalog id does, since the key is right there in the
   * value. A legacy reference is never looked up and therefore never `null`.
   */
  urlFor(value: string): string | null {
    if (typeof value !== "string" || !value.trim()) return value;
    const trimmed = value.trim();

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    // Nothing can root this: no bucket, no configured base, and a dispatched
    // request that crossed no socket to learn an origin from. Rewriting into a
    // hostname that resolves nowhere is worse than not rewriting (D35).
    if (!this.store && !this.base && !this.origin) return trimmed;

    if (MediaRef.is(trimmed)) {
      const id = MediaRef.idOf(trimmed);
      if (!id) return trimmed;
      if (this.asked.has(id) && !this.keys.has(id)) return null;
      return this.forAsset(id, this.keys.get(id));
    }

    const legacyKey = MediaRef.legacyKeyOf(trimmed);
    return legacyKey ? this.forAsset(legacyKey, legacyKey) : trimmed;
  }

  /**
   * The URL for an asset whose blob key is already known, which is the case
   * everywhere the catalog is at hand — including the media library's own
   * listing, so what the admin shows is the link the API hands out.
   *
   * Exactly two shapes, and which one is used is decided by `base_url` alone
   * (D60). Silo's route is `/media/<id>` and nothing else it serves is
   * addressed by blob key, so pinning the base to that route is what makes a
   * configured base always resolve.
   */
  forAsset(id: string, blobKey?: string): string {
    // `base_url` names **silo**, wherever it has been published — behind a
    // proxy, on a custom domain, under a path prefix. So it always takes
    // silo's own route, whatever the store is. Joining a blob key onto it
    // instead is what produced `https://api.example.com/<ulid>.jpg`: a
    // well-formed URL for a path silo does not serve.
    if (this.base) return `${this.base}/media/${id}`;

    // No base, so the store speaks for itself: a bucket that serves its own
    // objects is addressed directly and silo leaves the read path. This is the
    // one shape that is not `/media/<id>`, and it is S3's own addressing
    // rather than anything silo invented.
    if (this.store && blobKey) return `${this.store}/${blobKey.replace(/^\/+/, "")}`;

    // Either silo serves the bytes, or it is a bucket-backed asset whose key
    // was never looked up (past `MediaLinkResolver`'s cap). Both are silo's
    // route at the address the request arrived on — the one host known to
    // answer it. D35's judgement: a relative URL beats one resolving nowhere.
    return this.origin ? `${this.origin}/media/${id}` : `/media/${id}`;
  }

  private static trim(value: string): string {
    return typeof value === "string" ? value.replace(/\/+$/, "") : "";
  }
}
