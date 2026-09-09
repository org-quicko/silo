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
 * **One rule, and no setting to get it wrong** (D58). The store decides the
 * *shape* and `base_url` decides the *host*:
 *
 * - The store is publicly addressable (a bucket): `<root>/<blob key>`, where
 *   the root is `base_url` when it is set and the bucket's own otherwise. Silo
 *   is out of the read path either way, so `base_url` here is a CDN over the
 *   same objects.
 * - It is not (the fs driver): `<root>/media/<id>`, where the root is
 *   `base_url` when it is set and the address the request arrived on
 *   otherwise. Silo streams the bytes, and `base_url` is a name in front of it.
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
   * A bucket-backed asset whose key is *not* known falls back to **silo's own
   * origin**, never to `base_url`. The base names a CDN over the bucket that
   * has never heard of `/media/<id>`, so rooting a path there would hand back
   * a link that 404s; the origin is the one host known to serve it. Same
   * judgement as D35's empty base: a URL that resolves nowhere is worse than a
   * relative one.
   */
  forAsset(id: string, blobKey?: string): string {
    if (this.store) {
      if (blobKey) return `${this.base || this.store}/${blobKey.replace(/^\/+/, "")}`;
      return this.origin ? `${this.origin}/media/${id}` : `/media/${id}`;
    }

    const root = this.base || this.origin;
    return root ? `${root}/media/${id}` : `/media/${id}`;
  }

  private static trim(value: string): string {
    return typeof value === "string" ? value.replace(/\/+$/, "") : "";
  }
}
