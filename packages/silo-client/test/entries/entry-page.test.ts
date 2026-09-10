import { describe, expect, test } from "bun:test";
import { EntryPage, type EntryPageLoader } from "../../src/entries/entry-page";
import { PageWindow } from "../../src/pagination/page-window";

describe("EntryPage", () => {
  test("next() advances by the window the server echoed, not the one requested", async () => {
    const requestedWindows: PageWindow[] = [];
    const loader: EntryPageLoader<string> = async (window) => {
      requestedWindows.push(window);
      // The server clamped the requested limit of 900 down to 500.
      return new EntryPage(["a", "b"], 502, new PageWindow(500, 500), loader);
    };

    const first = new EntryPage(["row"], 502, new PageWindow(500, 0), loader);
    const second = await first.next();

    expect(second).not.toBeNull();
    expect(requestedWindows).toEqual([new PageWindow(500, 500)]);
    expect(second?.offset).toBe(500);
  });

  test("previous() is null before the start", async () => {
    const loader: EntryPageLoader<string> = async (window) => new EntryPage([], 0, window, loader);
    const first = new EntryPage([], 0, new PageWindow(50, 0), loader);

    expect(await first.previous()).toBeNull();
  });

  test("next() is null once hasMore is false", async () => {
    const loader: EntryPageLoader<string> = async (window) => new EntryPage([], 0, window, loader);
    const page = new EntryPage(["only"], 1, new PageWindow(50, 0), loader);

    expect(page.hasMore).toBe(false);
    expect(await page.next()).toBeNull();
  });

  test("entries exposes the rows, and pageNumber/pageCount follow the echoed window", () => {
    const loader: EntryPageLoader<string> = async (window) => new EntryPage([], 0, window, loader);
    const page = new EntryPage(["a", "b"], 12, new PageWindow(5, 5), loader);

    expect(page.entries).toEqual(["a", "b"]);
    expect(page.pageNumber).toBe(2);
    expect(page.pageCount).toBe(3);
    expect([...page]).toEqual(["a", "b"]);
  });
});
