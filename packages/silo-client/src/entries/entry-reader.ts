import { PageWindow } from "../pagination/page-window.js";
import type { RowLoader } from "../pagination/row-stream.js";
import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import { PagePayload } from "../transport/page-payload.js";
import type { EntryContext } from "./entry-base.js";
import type { EntryListQuery } from "./entry-list-query.js";
import { EntryPage, type EntryPageLoader } from "./entry-page.js";
import { EntryPageStream } from "./entry-page-stream.js";
import type { EntryPayload } from "./entry-payload.js";
import { EntryStream } from "./entry-stream.js";

/**
 * Reads entries out of one collection and hands each answer to `wrap`.
 *
 * A collection holds two: one asks for substituted values and answers
 * snapshots, the other asks for the stored templates and answers editable
 * entries. Both read the same routes, so the paging is written once here.
 */
export class EntryReader<Row> {
  constructor(
    private readonly context: EntryContext,
    private readonly variables: "raw" | undefined,
    private readonly wrap: (payload: EntryPayload) => Row,
  ) {}

  async get(id: string, options: RequestOptions = {}): Promise<Row> {
    const payload = await this.context.transport.json<EntryPayload>({
      method: "GET",
      path: ApiPath.entry(this.context.project, this.context.environment, this.context.collection, id),
      query: { variables: this.variables },
      ...options,
    });
    return this.wrap(payload);
  }

  async list(query: EntryListQuery = {}, options: RequestOptions = {}): Promise<EntryPage<Row>> {
    const loader: EntryPageLoader<Row> = (window) =>
      this.list({ ...query, limit: window.limit, offset: window.offset }, options);

    const body = await this.context.transport.json<Record<string, unknown>>({
      method: "GET",
      path: ApiPath.entries(this.context.project, this.context.environment, this.context.collection),
      query: {
        limit: query.limit,
        offset: query.offset,
        filter: query.where?.toJSON(),
        sort: query.sort === undefined ? undefined : String(query.sort),
        variables: this.variables,
      },
      ...options,
    });

    const page = PagePayload.read<EntryPayload>(body);
    const window = new PageWindow(page.limit ?? query.limit ?? 50, page.offset ?? query.offset ?? 0);
    return new EntryPage(page.rows.map((payload) => this.wrap(payload)), page.total, window, loader);
  }

  /** Every matching entry, one at a time, `limit` rows per request. */
  all(query: EntryListQuery = {}, options: RequestOptions = {}): EntryStream<Row> {
    const loader: RowLoader<Row> = async (window) => {
      const page = await this.list({ ...query, limit: window.limit, offset: window.offset }, options);
      return { rows: [...page.entries], window: new PageWindow(page.limit, page.offset) };
    };
    return new EntryStream(loader, query.limit ?? 50, options);
  }

  /** Every matching page, one at a time. */
  pages(query: EntryListQuery = {}, options: RequestOptions = {}): EntryPageStream<Row> {
    return new EntryPageStream(() => this.list(query, options), options);
  }
}
