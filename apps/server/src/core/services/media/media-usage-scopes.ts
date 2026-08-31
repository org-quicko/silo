import { MediaCatalog } from "../../media/media-catalog";
import type { MediaUsage } from "../../media/media-usage";
import type { MediaUsageScope } from "../../media/media-usage-scope";
import type { ServiceContext } from "../support/service-context";
import type { MediaCatalogStore } from "./media-catalog-store";

/** What a force-delete's reach requires knowing (D49): the distinct scopes
 *  that currently refer to the assets it would touch, and whether there were
 *  too many referring rows to enumerate exactly. */
export interface MediaForceReach {
  scopes: MediaUsageScope[];
  total: number;
  /** `true` when `total` exceeded the enumeration cap — `scopes` was not
   *  computed and must not be trusted for an authority decision. */
  capped: boolean;
}

/**
 * The **true** referrer set a media force-delete would reach, never the
 * claim-filtered one `MediaRoutes` shows a caller (D49, §8.1).
 *
 * Filtering first would let a key force-delete *because* it cannot see the
 * referrers — a key that cannot read a scope necessarily lacks
 * `entries:update` there, so `RouteAuth.requireForcedMediaDelete` refuses it,
 * which is the correct and self-consistent outcome only if this enumerates
 * the whole truth first.
 */
export class MediaUsageScopes {
  /** `Storage.listMediaUsages` pages rows, not scopes, so every row has to be
   *  seen before distinct scopes can be trusted. 2000 is generous for any
   *  library this check is meant to gate in practice; past it, the authority
   *  decision falls back to requiring root rather than trusting a partial
   *  scan (`docs/design/http-api.md` §8.1 names why this is a fixed cap and
   *  not a `listMediaUsageScopes` port method). Shared by
   *  `MediaAssetService.usages`, which counts a true "visible" referrer count
   *  up to the same bound rather than inventing a cap of its own. */
  static readonly EnumerationCap = 2000;

  /** Rows fetched per `listMediaUsages` call while scanning toward the cap —
   *  independent of the cap itself: this bounds one request's size, the cap
   *  bounds how many are read in total before giving up on an exact answer. */
  private static readonly PageSize = 200;

  private readonly context: ServiceContext;
  private readonly catalog: MediaCatalogStore;

  constructor(context: ServiceContext, catalog: MediaCatalogStore) {
    this.context = context;
    this.catalog = catalog;
  }

  /** Pages usage rows for `ids` up to {@link EnumerationCap} and reduces them
   *  to distinct scopes. An id that no longer resolves to an asset (already
   *  gone, or never existed) contributes no tokens — its absence from the
   *  reach is correct, since deleting it needs no authority over anything. */
  async reach(ids: readonly string[]): Promise<MediaForceReach> {
    const tokens: string[] = [];
    for (const id of ids) {
      const entry = await this.catalog.findAsset(id);
      if (!entry) continue;
      tokens.push(...MediaCatalog.tokens(entry.id, MediaCatalog.toAsset(entry).blob_key));
    }
    if (tokens.length === 0) return { scopes: [], total: 0, capped: false };

    const { rows, total } = await this.scanUpToCap(tokens);
    if (total > MediaUsageScopes.EnumerationCap) {
      return { scopes: [], total, capped: true };
    }

    const seen = new Set<string>();
    const scopes: MediaUsageScope[] = [];
    for (const usage of rows) {
      const key = `${usage.project}/${usage.env}/${usage.collection}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scopes.push({ project: usage.project, env: usage.env, collection: usage.collection });
    }
    return { scopes, total, capped: false };
  }

  /** Genuinely pages `listMediaUsages` in {@link PageSize} batches, stopping
   *  once every row is read or the cap is reached — whichever comes first,
   *  since a total past the cap makes reading further pointless: the answer
   *  is "capped" either way. `total` is a fact about the whole matching set,
   *  answered the same regardless of the page requested, so the last page
   *  fetched carries the true count even when the scan stopped short of it. */
  private async scanUpToCap(tokens: string[]): Promise<{ rows: MediaUsage[]; total: number }> {
    const rows: MediaUsage[] = [];
    let offset = 0;
    let total = 0;
    while (offset < MediaUsageScopes.EnumerationCap) {
      const page = await this.context.store.listMediaUsages(tokens, {
        limit: Math.min(MediaUsageScopes.PageSize, MediaUsageScopes.EnumerationCap - offset),
        offset,
      });
      total = page.total;
      rows.push(...page.items);
      offset += page.items.length;
      if (page.items.length === 0 || offset >= total) break;
    }
    return { rows, total };
  }
}
