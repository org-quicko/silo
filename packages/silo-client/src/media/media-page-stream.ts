import { RequestAbortedError } from "../errors/request-aborted-error.js";
import type { RequestOptions } from "../request-options.js";
import type { MediaPage } from "./media-page.js";

/** `Media.pages()`'s async-iterable: one whole `MediaPage` at a time,
 * stopping once a page reports no more. */
export class MediaPageStream implements AsyncIterable<MediaPage> {
  constructor(
    private readonly first: () => Promise<MediaPage>,
    private readonly options: RequestOptions = {},
  ) {}

  async *[Symbol.asyncIterator](): AsyncIterator<MediaPage> {
    let page: MediaPage | null = await this.first();
    while (page) {
      if (this.options.signal?.aborted) {
        throw new RequestAbortedError("GET", "stream");
      }
      yield page;
      page = page.hasMore ? await page.next(this.options) : null;
    }
  }
}
