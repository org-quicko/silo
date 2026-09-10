/**
 * The `limit` and `offset` a page answered — as the server clamped them, not
 * as they were asked for. Navigation is arithmetic on this window, not
 * on the request that produced it.
 */
export class PageWindow {
  constructor(
    readonly limit: number,
    readonly offset: number,
  ) {}

  /** The window one page ahead. */
  next(): PageWindow {
    return new PageWindow(this.limit, this.offset + this.limit);
  }

  /** The window one page back, or `null` before the start. */
  previous(): PageWindow | null {
    if (this.offset <= 0) return null;
    return new PageWindow(this.limit, Math.max(0, this.offset - this.limit));
  }
}
