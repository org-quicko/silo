import { MediaRef } from "@silo/shared/media-ref";
import type { MediaConfig } from "../../config/media-config";

/**
 * Turning a stored media reference into a URL a client can fetch (D46, D48).
 *
 * One object rather than a `baseUrl` string, because since `[media]` there are
 * three facts in the answer and not one: where URLs are rooted, whether that
 * name fronts silo or the object store, and — only in the second case — which
 * blob key each asset holds. Passing them separately would put the decision at
 * every call site instead of here.
 *
 * A reference resolves to one of three states, not two. **Not asked** — the
 * id was never looked up (`fromRequest`, or an id past
 * `MediaLinkResolver`'s cap) — resolves exactly as every response did before
 * D48, because nothing here learned whether the asset still exists. **Asked
 * and present** is a URL, same as always. **Asked and absent** is `null`: the
 * catalog was consulted and the id is gone, most often a force-delete (D48).
 * `keys` says which ids were found; `asked` says which were looked up at all
 * — the difference between the two is "asked and absent", so the two are
 * kept apart rather than folding "not found" into an empty `keys` entry,
 * which cannot be told apart from "never checked".
 *
 * Deliberately **synchronous**. `EntryUtils.toApiResponse` is a pure function
 * and every route calls it inside a `map`, so anything this needs from storage
 * is resolved before it is built (`MediaService.links` / `MediaLinkResolver`),
 * never from inside it.
 */
export class MediaLinks {
  /** Where the request itself reached this instance. Always serviceable, which
   *  is what makes it the fallback when the configured base cannot answer. */
  private readonly origin: string;
  private readonly base: string;
  private readonly target: "server" | "store";
  /** Asset id to blob key, for every id that was looked up and found. */
  private readonly keys: Map<string, string>;
  /** Every id that was looked up at all, found or not (D48). */
  private readonly asked: Set<string>;

  private constructor(
    origin: string,
    base: string,
    target: "server" | "store",
    keys: Map<string, string>,
    asked: Set<string>
  ) {
    this.origin = MediaLinks.trim(origin);
    this.base = MediaLinks.trim(base);
    this.target = target;
    this.keys = keys;
    this.asked = asked;
  }

  /** No `[media]` in play: URLs are rooted at the request, addressed by id,
   *  and nothing was ever asked about. What every response did before D46,
   *  and what a test wants. */
  static fromRequest(requestBase: string): MediaLinks {
    return new MediaLinks(requestBase, requestBase, "server", new Map(), new Set());
  }

  /**
   * The configured answer.
   *
   * `base_url` unset falls back to the request's own origin rather than to
   * nothing, so the target alone is still meaningful: an operator who names
   * only `store` gets bucket-shaped paths under the origin they are already
   * being served from, which is wrong in a way they can see, rather than a
   * setting that silently did nothing.
   *
   * `keys` and `asked` default to empty, which is "nothing was looked up" —
   * the same as before D48 — for every caller that does not pass them.
   */
  static of(
    config: MediaConfig,
    requestBase: string,
    keys?: Map<string, string>,
    asked?: Set<string>
  ): MediaLinks {
    return new MediaLinks(
      requestBase,
      config.base_url || requestBase,
      config.base_url_target,
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
   * correctly while it is being backfilled — and in store mode it resolves
   * *better* than a catalog id does, since the key is right there in the
   * value. A legacy reference is never looked up and therefore never `null`.
   */
  urlFor(value: string): string | null {
    if (typeof value !== "string" || !value.trim()) return value;
    const trimmed = value.trim();

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    if (!this.base && !this.origin) return trimmed;

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
   * everywhere the catalog is at hand.
   *
   * A store-mode asset with no key falls back to **silo's own origin**, not to
   * the configured base. The base names a CDN that has never heard of
   * `/media/<id>`, so rooting a path there would hand back a link that 404s;
   * the origin is the one host known to serve it. Same judgement as D35's
   * empty base: a URL that resolves nowhere is worse than a plain one.
   */
  forAsset(id: string, blobKey?: string): string {
    if (this.target === "store" && blobKey) {
      return `${this.base}/${blobKey.replace(/^\/+/, "")}`;
    }
    const root = this.target === "store" ? this.origin : this.base;
    return root ? `${root}/media/${id}` : `/media/${id}`;
  }

  private static trim(value: string): string {
    return typeof value === "string" ? value.replace(/\/+$/, "") : "";
  }
}
