import { describe, expect, test } from "bun:test";
import { Page } from "../../src/pagination/page";
import { PageWindow } from "../../src/pagination/page-window";

/** The minimal concrete subclass needed to exercise the abstract base —
 *  `Page` itself declares no `next()`/`previous()`, by design. */
class TestPage extends Page<string> {
  constructor(rows: string[], total: number, window: PageWindow, truncated = false) {
    super(rows, total, window, truncated);
  }

  nextWindow(): PageWindow | null {
    return this.windowForNext();
  }
}

describe("Page: normal (non-truncated)", () => {
  test("pageNumber and pageCount", () => {
    const first = new TestPage(Array(50).fill("row"), 137, new PageWindow(50, 0));
    expect(first.pageNumber).toBe(1);
    expect(first.pageCount).toBe(3);

    const second = new TestPage(Array(50).fill("row"), 137, new PageWindow(50, 50));
    expect(second.pageNumber).toBe(2);
  });

  test("hasMore is offset + rows.length < total", () => {
    const first = new TestPage(Array(50).fill("row"), 137, new PageWindow(50, 0));
    expect(first.hasMore).toBe(true);

    const last = new TestPage(Array(37).fill("row"), 137, new PageWindow(50, 100));
    expect(last.hasMore).toBe(false);
  });

  test("windowForNext is null once there is no more", () => {
    const last = new TestPage(Array(37).fill("row"), 137, new PageWindow(50, 100));
    expect(last.nextWindow()).toBeNull();

    const first = new TestPage(Array(50).fill("row"), 137, new PageWindow(50, 0));
    expect(first.nextWindow()).toEqual(new PageWindow(50, 50));
  });
});

describe("Page: truncated", () => {
  test("pageCount is null", () => {
    const page = new TestPage(Array(50).fill("row"), 5000, new PageWindow(50, 0), true);
    expect(page.pageCount).toBeNull();
  });

  test("hasMore falls back to a full page rather than the total", () => {
    const full = new TestPage(Array(50).fill("row"), 5000, new PageWindow(50, 0), true);
    expect(full.hasMore).toBe(true);

    const short = new TestPage(Array(12).fill("row"), 5000, new PageWindow(50, 0), true);
    expect(short.hasMore).toBe(false);
  });

  test("windowForNext follows hasMore, not the total", () => {
    const full = new TestPage(Array(50).fill("row"), 5000, new PageWindow(50, 0), true);
    expect(full.nextWindow()).toEqual(new PageWindow(50, 50));

    const short = new TestPage(Array(12).fill("row"), 5000, new PageWindow(50, 0), true);
    expect(short.nextWindow()).toBeNull();
  });
});

describe("Page: iteration", () => {
  test("is iterable over its rows", () => {
    const page = new TestPage(["a", "b", "c"], 3, new PageWindow(50, 0));
    expect([...page]).toEqual(["a", "b", "c"]);

    const collected: string[] = [];
    for (const row of page) collected.push(row);
    expect(collected).toEqual(["a", "b", "c"]);
  });
});
