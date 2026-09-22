import { Page } from "../pagination/page.js";
import { PageWindow } from "../pagination/page-window.js";
import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import type { TransportQueryValue } from "../transport/transport-request.js";
import type { TrashRecord } from "./trash-record.js";

/** One page of `Trash.list()`. Navigates by the window the server echoed. */
export class TrashPage extends Page<TrashRecord> {
  private constructor(
    rows: TrashRecord[],
    total: number,
    window: PageWindow,
    private readonly transport: Transport,
    private readonly wireQuery: Record<string, TransportQueryValue>,
  ) {
    super(rows, total, window);
  }

  get items(): readonly TrashRecord[] {
    return this.rows;
  }

  async next(options?: RequestOptions): Promise<TrashPage | null> {
    const window = this.windowForNext();
    return window ? TrashPage.loadWindow(this.transport, this.wireQuery, window, options) : null;
  }

  async previous(options?: RequestOptions): Promise<TrashPage | null> {
    const window = this.window.previous();
    return window ? TrashPage.loadWindow(this.transport, this.wireQuery, window, options) : null;
  }

  static async loadWindow(
    transport: Transport,
    wireQuery: Record<string, TransportQueryValue>,
    window: PageWindow,
    options?: RequestOptions,
  ): Promise<TrashPage> {
    const body = await transport.json<{
      items: TrashRecord[];
      total: number;
      limit: number;
      offset: number;
    }>({
      method: "GET",
      path: ApiPath.trash(),
      query: { ...wireQuery, limit: window.limit, offset: window.offset },
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
    return new TrashPage(
      body.items,
      body.total,
      new PageWindow(body.limit, body.offset),
      transport,
      wireQuery,
    );
  }
}
