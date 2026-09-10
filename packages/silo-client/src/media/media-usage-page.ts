import { Page } from "../pagination/page.js";
import { PageWindow } from "../pagination/page-window.js";
import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import { MediaAssetMapper } from "./media-asset-mapper.js";
import type { MediaUsage } from "./media-usage.js";

/** `MediaAsset.usages()`'s query. The wire echoes no window, so the
 * page is built from what was asked for rather than what came back. */
export interface MediaUsageQuery {
  limit?: number;
  offset?: number;
}

/** Matches the usages route's own fallback when `limit` is omitted
 * (`SqliteMediaReferenceStore.FallbackLimit`, server-side). */
const DefaultUsageLimit = 50;

/**
 * One page of an asset's referrers, and the awkward page shape. The wire gives a
 * true `total` this key may not fully see, plus `visible` (what it may) and
 * `visibleCapped`, and echoes no window at all. `total` still reports the
 * true count via the base class; `pageCount`/`hasMore` are overridden here
 * to derive from `visible` instead, since that is all these rows can ever
 * add up to — not touching `Page` itself, since `total` keeps its normal
 * meaning for every other page in the client.
 */
export class MediaUsagePage extends Page<MediaUsage> {
  readonly visible: number;
  readonly visibleCapped: boolean;

  private constructor(
    rows: MediaUsage[],
    total: number,
    visible: number,
    visibleCapped: boolean,
    window: PageWindow,
    private readonly transport: Transport,
    private readonly assetId: string,
  ) {
    super(rows, total, window);
    this.visible = visible;
    this.visibleCapped = visibleCapped;
  }

  get usages(): readonly MediaUsage[] {
    return this.rows;
  }

  override get pageCount(): number | null {
    return Math.max(1, Math.ceil(this.visible / this.limit));
  }

  override get hasMore(): boolean {
    return this.offset + this.rows.length < this.visible;
  }

  async next(options?: RequestOptions): Promise<MediaUsagePage | null> {
    const window = this.windowForNext();
    return window ? MediaUsagePage.loadWindow(this.transport, this.assetId, window, options) : null;
  }

  async previous(options?: RequestOptions): Promise<MediaUsagePage | null> {
    const window = this.window.previous();
    return window ? MediaUsagePage.loadWindow(this.transport, this.assetId, window, options) : null;
  }

  /** `MediaAsset.usages()`'s entry point: builds the requested window itself,
   * since the server does not echo one back. */
  static load(
    transport: Transport,
    assetId: string,
    query: MediaUsageQuery,
    options?: RequestOptions,
  ): Promise<MediaUsagePage> {
    const window = new PageWindow(query.limit ?? DefaultUsageLimit, query.offset ?? 0);
    return MediaUsagePage.loadWindow(transport, assetId, window, options);
  }

  private static async loadWindow(
    transport: Transport,
    assetId: string,
    window: PageWindow,
    options?: RequestOptions,
  ): Promise<MediaUsagePage> {
    const body = await transport.json<{ items: unknown[]; total: number; visible: number; visible_capped: boolean }>({
      method: "GET",
      path: ApiPath.mediaAssetUsages(assetId),
      query: { limit: window.limit, offset: window.offset },
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
    const mapped = MediaAssetMapper.toUsagePage(body);
    return new MediaUsagePage(mapped.items, mapped.total, mapped.visible, mapped.visibleCapped, window, transport, assetId);
  }
}
