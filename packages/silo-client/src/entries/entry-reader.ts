import { Cache } from "../cache/Cache.js";
import { PageWindow } from "../pagination/page-window.js";
import type { RowLoader } from "../pagination/row-stream.js";
import type { ScopeReference } from "../scope/scope-reference.js";
import { ApiPath } from "../transport/api-path.js";
import { PagePayload } from "../transport/page-payload.js";
import { TransportRequest } from "../transport/transport-request.js";
import type { Entry } from "./entry.js";
import type { EntryListQuery } from "./entry-list-query.js";
import { EntryPage, type EntryPageLoader } from "./entry-page.js";
import { EntryPageStream } from "./entry-page-stream.js";
import type { EntryReadOptions } from "./entry-read-options.js";
import { EntryStream } from "./entry-stream.js";

/**
 * The four reads of one collection: one entry, one page, every entry, every
 * page.
 *
 * Nothing is mapped on the way through — an answer is the wire's own row
 * (D62) — so what this class actually owns is the paging the four share and
 * the one place `variables` is turned into a query parameter.
 */
export class EntryReader<Fields> {
  constructor(
    private readonly scope: ScopeReference,
    private readonly collection: string,
  ) {}

  @Cache()
  get(id: string, options: EntryReadOptions = {}): Promise<Entry<Fields>> {
    return this.scope.transport.json<Entry<Fields>>(
      TransportRequest.get(ApiPath.entry(this.scope.project, this.scope.environment, this.collection, id))
        .query("variables", options.variables)
        .options(options)
        .cache(this.get)
        .build(),
    );
  }

  @Cache()
  async list(query: EntryListQuery = {}, options: EntryReadOptions = {}): Promise<EntryPage<Entry<Fields>>> {
    const loader: EntryPageLoader<Entry<Fields>> = (window) =>
      this.list({ ...query, limit: window.limit, offset: window.offset }, options);

    const body = await this.scope.transport.json<Record<string, unknown>>(
      TransportRequest.get(ApiPath.entries(this.scope.project, this.scope.environment, this.collection))
        .query("limit", query.limit)
        .query("offset", query.offset)
        .query("filter", query.where?.toJSON())
        .query("sort", query.sort === undefined ? undefined : String(query.sort))
        .query("variables", options.variables)
        .options(options)
        .cache(this.list)
        .build(),
    );

    const page = PagePayload.read<Entry<Fields>>(body);
    const window = new PageWindow(page.limit ?? query.limit ?? 50, page.offset ?? query.offset ?? 0);
    return new EntryPage(page.rows, page.total, window, loader);
  }

  /** Every matching entry, one at a time, `limit` rows per request. */
  all(query: EntryListQuery = {}, options: EntryReadOptions = {}): EntryStream<Entry<Fields>> {
    const loader: RowLoader<Entry<Fields>> = async (window) => {
      const page = await this.list({ ...query, limit: window.limit, offset: window.offset }, options);
      return { rows: [...page.entries], window: new PageWindow(page.limit, page.offset) };
    };
    return new EntryStream(loader, query.limit ?? 50, options);
  }

  /** Every matching page, one at a time. */
  pages(query: EntryListQuery = {}, options: EntryReadOptions = {}): EntryPageStream<Entry<Fields>> {
    return new EntryPageStream(() => this.list(query, options), options);
  }
}
