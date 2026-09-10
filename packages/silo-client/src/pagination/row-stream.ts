import { RequestAbortedError } from "../errors/request-aborted-error.js";
import type { RequestOptions } from "../request-options.js";
import { PageWindow } from "./page-window.js";

/** Loads one page for a given window, and answers the window the server
 * actually used. */
export type RowLoader<Row> = (window: PageWindow) => Promise<{ rows: Row[]; window: PageWindow }>;

/**
 * The shared auto-pager behind `collection.all()` and similar.
 * Advances by the window the server echoed, never by what was asked for, and
 * stops on the first short or empty page — the sign that nothing more is
 * behind it.
 *
 * Offset iteration over data being written concurrently is not a snapshot:
 * an entry created ahead of the cursor can be missed, and one deleted behind
 * it can shift a row into a page already yielded.
 */
export class RowStream<Row> implements AsyncIterable<Row> {
  private readonly loader: RowLoader<Row>;
  private readonly startingLimit: number;
  private readonly options: RequestOptions;

  constructor(loader: RowLoader<Row>, startingLimit: number, options: RequestOptions = {}) {
    this.loader = loader;
    this.startingLimit = startingLimit;
    this.options = options;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Row> {
    let window: PageWindow | null = new PageWindow(this.startingLimit, 0);

    while (window) {
      if (this.options.signal?.aborted) {
        throw new RequestAbortedError("GET", "stream");
      }

      const page = await this.loader(window);
      yield* page.rows;

      const short = page.rows.length === 0 || page.rows.length < page.window.limit;
      window = short ? null : page.window.next();
    }
  }

  /** Drains the whole stream, for a caller who knows the result set is
   * small. */
  async toArray(): Promise<Row[]> {
    const rows: Row[] = [];
    for await (const row of this) rows.push(row);
    return rows;
  }
}
