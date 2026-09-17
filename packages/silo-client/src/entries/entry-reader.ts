import type { TTLCache } from "@isaacs/ttlcache";
import { Cache, CACHE_MAP_KEY } from "@org-quicko/core/cache";
import { PageWindow } from "../pagination/page-window.js";
import type { RowLoader } from "../pagination/row-stream.js";
import type { ScopeReference } from "../scope/scope-reference.js";
import { ApiPath } from "../transport/api-path.js";
import { PagePayload } from "../transport/page-payload.js";
import { QueryString } from "../transport/query-string.js";
import type { TransportRequest } from "../transport/transport-request.js";
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
  readonly [CACHE_MAP_KEY]: TTLCache<string, unknown> | undefined;

  constructor(
    private readonly scope: ScopeReference,
    private readonly collection: string,
  ) {
    this[CACHE_MAP_KEY] = scope.siloContext.cache;
  }

  get(id: string, options: EntryReadOptions = {}): Promise<Entry<Fields>> {
    const { variables, ...request } = options;
    return this.fetchData({
      method: "GET",
      path: ApiPath.entry(this.scope.project, this.scope.environment, this.collection, id),
      query: { variables },
      ...request,
    }) as Promise<Entry<Fields>>;
  }

  @Cache({
    key(request: TransportRequest & { method: "GET" }) {
      return `${request.path}${QueryString.build(request.query)}`;
    },
    unless: (body: unknown) => body === null,
  })
  private fetchData(request: TransportRequest & { method: "GET" }): Promise<Record<string, unknown>> {
    return this.scope.siloContext.transport.json<Record<string, unknown>>(request);
  }

  async list(query: EntryListQuery = {}, options: EntryReadOptions = {}): Promise<EntryPage<Entry<Fields>>> {
    const { variables, ...request } = options;
    const loader: EntryPageLoader<Entry<Fields>> = (window) =>
      this.list({ ...query, limit: window.limit, offset: window.offset }, options);

    const body = await this.fetchData({
      method: "GET",
      path: ApiPath.entries(this.scope.project, this.scope.environment, this.collection),
      query: {
        limit: query.limit,
        offset: query.offset,
        filter: query.where?.toJSON(),
        sort: query.sort === undefined ? undefined : String(query.sort),
        variables,
      },
      ...request,
    });

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
