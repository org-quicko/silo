import { Page } from "../pagination/page.js";
import { PageWindow } from "../pagination/page-window.js";
import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import type { TransportQueryValue } from "../transport/transport-request.js";
import { MediaAsset } from "./media-asset.js";
import { MediaAssetMapper } from "./media-asset-mapper.js";
import type { MediaAssetPayload } from "./media-asset-payload.js";

/** One page of `Media.list()`: rows named `files`. Navigates by the
 * window the server ECHOED, never the one requested. */
export class MediaPage extends Page<MediaAsset> {
  private constructor(
    rows: MediaAsset[],
    total: number,
    window: PageWindow,
    private readonly transport: Transport,
    private readonly wireQuery: Record<string, TransportQueryValue>,
  ) {
    super(rows, total, window);
  }

  get files(): readonly MediaAsset[] {
    return this.rows;
  }

  async next(options?: RequestOptions): Promise<MediaPage | null> {
    const window = this.windowForNext();
    return window ? MediaPage.loadWindow(this.transport, this.wireQuery, window, options) : null;
  }

  async previous(options?: RequestOptions): Promise<MediaPage | null> {
    const window = this.window.previous();
    return window ? MediaPage.loadWindow(this.transport, this.wireQuery, window, options) : null;
  }

  /** `Media` builds `wireQuery` (already translated onto `q`/`ext`/etc.,
   * without `limit`/`offset`) once; `next`/`previous` reuse it unchanged. */
  static async loadWindow(
    transport: Transport,
    wireQuery: Record<string, TransportQueryValue>,
    window: PageWindow,
    options?: RequestOptions,
  ): Promise<MediaPage> {
    const body = await transport.json<{ items: MediaAssetPayload[]; total: number; limit: number; offset: number }>({
      method: "GET",
      path: ApiPath.media(),
      query: { ...wireQuery, limit: window.limit, offset: window.offset },
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
    const rows = body.items.map((payload) => new MediaAsset(transport, MediaAssetMapper.toRecord(payload)));
    return new MediaPage(rows, body.total, new PageWindow(body.limit, body.offset), transport, wireQuery);
  }
}
