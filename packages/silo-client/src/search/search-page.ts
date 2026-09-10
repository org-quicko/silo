import { Page } from "../pagination/page.js";
import type { PageWindow } from "../pagination/page-window.js";
import type { SearchEngine } from "./search-engine.js";
import type { SearchHit } from "./search-hit.js";

/** Loads the page at `window`, keeping whatever query produced this page. */
export type SearchPageLoader = (window: PageWindow) => Promise<SearchPage>;

/**
 * One page of search results. `pageCount` is `null` when
 * `truncated` — the base `Page` class already does that; this only adds
 * `hits` and `engine`.
 */
export class SearchPage extends Page<SearchHit> {
  readonly engine: SearchEngine;

  constructor(
    rows: readonly SearchHit[],
    total: number,
    window: PageWindow,
    truncated: boolean,
    engine: SearchEngine,
    private readonly loader: SearchPageLoader,
  ) {
    super(rows, total, window, truncated);
    this.engine = engine;
  }

  get hits(): readonly SearchHit[] {
    return this.rows;
  }

  next(): Promise<SearchPage | null> {
    const window = this.windowForNext();
    return window ? this.loader(window) : Promise.resolve(null);
  }

  previous(): Promise<SearchPage | null> {
    const window = this.window.previous();
    return window ? this.loader(window) : Promise.resolve(null);
  }
}
