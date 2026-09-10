import { PageWindow } from "./page-window.js";

/**
 * The shared shape of one page of results. Holds rows, the answered
 * window, and the total, but does not load anything — a concrete page (an
 * `EntryPage`, a `MediaPage`,...) declares its own `next()`/`previous()`
 * that call its own loader and return its own type.
 *
 * `truncated` marks a page whose `total` counts what a scan examined rather
 * than what exists: `pageCount` is then unknowable, and `hasMore`
 * falls back to "this page came back full".
 */
export abstract class Page<Row> {
  protected readonly rows: readonly Row[];
  protected readonly window: PageWindow;
  readonly total: number;
  readonly truncated: boolean;

  protected constructor(rows: readonly Row[], total: number, window: PageWindow, truncated = false) {
    this.rows = rows;
    this.total = total;
    this.window = window;
    this.truncated = truncated;
  }

  get limit(): number {
    return this.window.limit;
  }

  get offset(): number {
    return this.window.offset;
  }

  get pageNumber(): number {
    return Math.floor(this.offset / this.limit) + 1;
  }

  get pageCount(): number | null {
    if (this.truncated) return null;
    return Math.max(1, Math.ceil(this.total / this.limit));
  }

  get hasMore(): boolean {
    if (this.truncated) return this.rows.length === this.limit;
    return this.offset + this.rows.length < this.total;
  }

  /** The window the next page would load, or `null` when there is not one —
   * so no subclass repeats the "only if there is more" arithmetic. */
  protected windowForNext(): PageWindow | null {
    return this.hasMore ? this.window.next() : null;
  }

  [Symbol.iterator](): Iterator<Row> {
    return this.rows[Symbol.iterator]();
  }
}
