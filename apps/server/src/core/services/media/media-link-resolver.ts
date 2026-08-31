import { MediaRef } from "@silo/shared/media-ref";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaLinks } from "../../media/media-links";
import { MediaRefs } from "../../media/media-refs";
import type { ServiceContext } from "../support/service-context";
import type { MediaCatalogStore } from "./media-catalog-store";

/**
 * Builds the `MediaLinks` a response resolves its media fields through (D46).
 *
 * It exists because one of the two URL shapes needs the catalog and the other
 * does not. `<base>/media/<id>` is derivable from the reference alone, which is
 * what has always kept `EntryUtils.toApiResponse` a pure, synchronous function;
 * `<base>/<blob key>` is not, because the key is on the record. So the lookup
 * happens **once per response, before the mapping**, rather than inside it.
 *
 * In the ordinary case this does no I/O at all and the whole class is one
 * object allocation: only `base_url_target = "store"` pays.
 */
export class MediaLinkResolver {
  /**
   * How many keys one response will look up. A page of entries that each
   * reference several assets is normal; a payload naming thousands is not, and
   * turning one read into thousands is the kind of amplification an entry
   * author should not be able to ask for. Past the cap the remaining
   * references resolve to silo's own origin, which serves them correctly.
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
    const links = MediaLinks.of(config, requestBase);
    if (!links.needsKeys) return links;

    return MediaLinks.of(config, requestBase, await this.keys(payload));
  }

  /**
   * Asset id to blob key for every reference in `payload`.
   *
   * `MediaRefs.extract` is the one walker, so what gets a URL here is exactly
   * what counts as a usage elsewhere. Its pre-D23 `blob:` tokens are dropped:
   * those name a key already, so `MediaLinks` resolves them without asking.
   */
  private async keys(payload: unknown): Promise<Map<string, string>> {
    const keys = new Map<string, string>();

    const ids = MediaRefs.extract(payload)
      .filter((token) => !token.startsWith(MediaRef.BlobTokenPrefix))
      .slice(0, MediaLinkResolver.MaxLookups);

    for (const id of ids) {
      const entry = await this.catalog.findAsset(id);
      if (entry) keys.set(id, MediaCatalog.toAsset(entry).blob_key);
    }
    return keys;
  }
}
