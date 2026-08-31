import { MediaRef } from "@silo/shared/media-ref";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaLinks } from "../../media/media-links";
import { MediaRefs } from "../../media/media-refs";
import type { ServiceContext } from "../support/service-context";
import type { MediaCatalogStore } from "./media-catalog-store";

/**
 * Builds the `MediaLinks` a response resolves its media fields through
 * (D46, D48).
 *
 * Every reference in the payload is looked up now, not only when
 * `base_url_target = "store"`: a force-deleted asset (D48) has to answer
 * `null` wherever its URL would have been rooted, and `MediaLinks` can only
 * tell "asked and absent" from "never asked" if the asking always happens.
 * What D46 bought by skipping the lookup in the ordinary case — zero I/O in
 * `server` mode — is gone; what replaces it is **one point read per distinct
 * reference in the payload**, `catalog.findAsset(id)` in a bounded loop, not
 * one query over the whole catalog. A single filtered query (`in` over
 * `$.id`) was tried first and reverted: `FsEntryStore.list` reads and
 * `JSON.parse`s every document in `_media` before filtering — its own doc
 * comment states the O(n)-per-query character §6.3 commits that adapter to —
 * so one query would cost the *entire catalog* per response holding even a
 * single reference, and on SQLite it is two statements, since `list` always
 * runs a `SELECT COUNT(*)` first that this caller has no use for. A loop of
 * point reads is bounded by the payload's distinct ids and by
 * {@link MediaLinkResolver.MaxLookups}, never by catalog size, and is a
 * point read — not a scan — on both adapters. The lookup still happens once
 * per response, before the mapping, which is what keeps
 * `EntryUtils.toApiResponse` a synchronous function.
 */
export class MediaLinkResolver {
  /**
   * How many ids one response will look up. A page of entries that each
   * reference several assets is normal; a payload naming thousands is not, and
   * turning one lookup into thousands of point reads is the kind of
   * amplification an entry author should not be able to ask for. Past the cap
   * the remaining references resolve to silo's own origin, which serves them
   * correctly — they are never asked about, so they are never nulled either.
   */
  private static readonly MaxLookups = 200;

  private readonly context: ServiceContext;
  private readonly catalog: MediaCatalogStore;

  constructor(context: ServiceContext, catalog: MediaCatalogStore) {
    this.context = context;
    this.catalog = catalog;
  }

  async forPayload(requestBase: string, payload: unknown): Promise<MediaLinks> {
    const config = this.context.mediaConfig;
    const { keys, asked } = await this.lookup(payload);
    return MediaLinks.of(config, requestBase, keys, asked);
  }

  /**
   * Asset id to blob key for every reference in `payload` that was found,
   * plus the full set of ids that were asked about at all.
   *
   * `MediaRefs.extract` is the one walker, so what gets asked about here is
   * exactly what counts as a usage elsewhere. Its pre-D23 `blob:` tokens are
   * dropped: those name a key already, so `MediaLinks` resolves them without
   * asking and never nulls them.
   */
  private async lookup(payload: unknown): Promise<{ keys: Map<string, string>; asked: Set<string> }> {
    const keys = new Map<string, string>();
    const asked = new Set<string>();

    const ids = MediaRefs.extract(payload)
      .filter((token) => !token.startsWith(MediaRef.BlobTokenPrefix))
      .slice(0, MediaLinkResolver.MaxLookups);

    if (ids.length === 0) return { keys, asked };

    // One point read per distinct id (D48) — never a query over the whole
    // catalog, which is what a filtered `in` lookup would cost on the fs
    // adapter (see the class doc comment).
    for (const id of ids) {
      asked.add(id);
      const entry = await this.catalog.findAsset(id);
      if (entry) keys.set(id, MediaCatalog.toAsset(entry).blob_key);
    }

    return { keys, asked };
  }
}
