import { RequestAbortedError } from "../errors/request-aborted-error.js";
import type { RequestOptions } from "../request-options.js";
import type { EntryPage } from "./entry-page.js";

/**
 * `collection.pages()`'s return type: whole pages, one at a time, advancing
 * by each page's own echoed window and stopping on the first short or empty
 * one — the same termination rule `RowStream` uses, applied one page
 * up.
 */
export class EntryPageStream<Row> implements AsyncIterable<EntryPage<Row>> {
  constructor(
    private readonly loadFirst: () => Promise<EntryPage<Row>>,
    private readonly options: RequestOptions = {},
  ) {}

  async *[Symbol.asyncIterator](): AsyncIterator<EntryPage<Row>> {
    let page: EntryPage<Row> | null = await this.loadFirst();

    while (page) {
      if (this.options.signal?.aborted) {
        throw new RequestAbortedError("GET", "stream");
      }
      yield page;
      const short: boolean = page.entries.length === 0 || page.entries.length < page.limit;
      page = short ? null : await page.next();
    }
  }
}
