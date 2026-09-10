import { describe, expect, test } from "bun:test";
import { EntryPage, type EntryPageLoader } from "../../src/entries/entry-page";
import { EntryPageStream } from "../../src/entries/entry-page-stream";
import { RequestAbortedError } from "../../src/errors/request-aborted-error";
import { PageWindow } from "../../src/pagination/page-window";

describe("EntryPageStream", () => {
  test("stops on the first short page", async () => {
    const loader: EntryPageLoader<string> = async (window) => {
      if (window.offset === 0) return new EntryPage(["a", "b"], 3, window, loader);
      return new EntryPage(["c"], 3, window, loader);
    };
    const first = () => loader(new PageWindow(2, 0));

    const pages: string[][] = [];
    for await (const page of new EntryPageStream(first)) {
      pages.push([...page.entries]);
    }

    expect(pages).toEqual([["a", "b"], ["c"]]);
  });

  test("stops immediately on an empty first page", async () => {
    const loader: EntryPageLoader<string> = async (window) => new EntryPage([], 0, window, loader);
    const first = () => loader(new PageWindow(10, 0));

    const pages: string[][] = [];
    for await (const page of new EntryPageStream(first)) pages.push([...page.entries]);

    expect(pages).toEqual([[]]);
  });

  test("honours an abort before loading another page", async () => {
    const controller = new AbortController();
    const loader: EntryPageLoader<string> = async (window) => {
      controller.abort();
      return new EntryPage(["a"], 5, window, loader);
    };
    const first = () => loader(new PageWindow(1, 0));

    const stream = new EntryPageStream(first, { signal: controller.signal });

    await expect(
      (async () => {
        const rows: string[] = [];
        for await (const page of stream) rows.push(...page.entries);
        return rows;
      })(),
    ).rejects.toBeInstanceOf(RequestAbortedError);
  });
});
