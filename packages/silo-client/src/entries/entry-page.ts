import { Page } from "../pagination/page.js";
import type { PageWindow } from "../pagination/page-window.js";

/** Loads the page at `window`, keeping whatever filter and sort produced
 * this page in the first place. */
export type EntryPageLoader<Row> = (window: PageWindow) => Promise<EntryPage<Row>>;

/**
 * One page of entries, navigated by the window the server echoed
 * rather than the one requested.
 */
export class EntryPage<Row> extends Page<Row> {
  constructor(
    rows: readonly Row[],
    total: number,
    window: PageWindow,
    private readonly loader: EntryPageLoader<Row>,
  ) {
    super(rows, total, window);
  }

  get entries(): readonly Row[] {
    return this.rows;
  }

  next(): Promise<EntryPage<Row> | null> {
    const window = this.windowForNext();
    return window ? this.loader(window) : Promise.resolve(null);
  }

  previous(): Promise<EntryPage<Row> | null> {
    const window = this.window.previous();
    return window ? this.loader(window) : Promise.resolve(null);
  }
}
