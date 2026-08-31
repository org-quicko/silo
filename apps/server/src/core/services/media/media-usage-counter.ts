import type { Entry } from "../../domain/entry";
import { MediaCatalog } from "../../media/media-catalog";
import type { MediaAssetView } from "../../media/media-asset-view";
import { MediaLinks } from "../../media/media-links";
import type { ServiceContext } from "../support/service-context";

/** Attaches reference counts to catalog documents. */
export class MediaUsageCounter {
  private readonly context: ServiceContext;

  constructor(context: ServiceContext) {
    this.context = context;
  }

  /** One `countMediaUsages` call for a whole page, not one per asset. */
  async withCounts(entries: Entry[]): Promise<MediaAssetView[]> {
    if (entries.length === 0) return [];

    const tokens: string[] = [];
    for (const entry of entries) {
      tokens.push(...MediaCatalog.tokens(entry.id, MediaCatalog.toAsset(entry).blob_key));
    }
    const counts = await this.context.store.countMediaUsages(tokens);
    // No request origin: the media API answers with the configured public URL
    // or with the relative path, never with a host it guessed (D46).
    const links = MediaLinks.of(this.context.mediaConfig, "");

    return entries.map((entry) => {
      const asset = MediaCatalog.toAsset(entry);
      let total = 0;
      for (const token of MediaCatalog.tokens(entry.id, asset.blob_key)) {
        total += counts.get(token) || 0;
      }
      return MediaCatalog.toView(entry, total, links);
    });
  }
}
