import { describe, expect, test } from "bun:test";
import { RequestAbortedError } from "../../src/errors/request-aborted-error";
import { PageWindow } from "../../src/pagination/page-window";
import type { RowLoader } from "../../src/pagination/row-stream";
import { RowStream } from "../../src/pagination/row-stream";

describe("RowStream", () => {
  test("stops on the first short page", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => `row-${index}`);
    const loader: RowLoader<string> = async (window) => ({
      rows: rows.slice(window.offset, window.offset + window.limit),
      window,
    });

    expect(await new RowStream(loader, 10).toArray()).toEqual(rows);
  });

  test("stops immediately on an empty first page", async () => {
    const loader: RowLoader<string> = async (window) => ({ rows: [], window });
    expect(await new RowStream(loader, 10).toArray()).toEqual([]);
  });

  test("advances by the window the loader echoes, not the one requested", async () => {
    const requestedWindows: PageWindow[] = [];
    const loader: RowLoader<string> = async (window) => {
      requestedWindows.push(window);
      if (requestedWindows.length === 1) {
        // The server clamped the requested limit of 10 down to 5, and this
        // page is full at that echoed limit.
        return { rows: ["a", "b", "c", "d", "e"], window: new PageWindow(5, 0) };
      }
      return { rows: ["f", "g", "h"], window: new PageWindow(5, 5) };
    };

    const rows = await new RowStream(loader, 10).toArray();

    expect(rows).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(requestedWindows).toEqual([new PageWindow(10, 0), new PageWindow(5, 5)]);
  });

  test("is async-iterable one row at a time", async () => {
    const loader: RowLoader<string> = async (window) =>
      window.offset === 0 ? { rows: ["a", "b"], window } : { rows: [], window };

    const collected: string[] = [];
    for await (const row of new RowStream(loader, 2)) collected.push(row);
    expect(collected).toEqual(["a", "b"]);
  });

  test("honours an abort mid-iteration, without loading another page", async () => {
    const controller = new AbortController();
    let callCount = 0;
    const loader: RowLoader<string> = async (window) => {
      callCount += 1;
      controller.abort();
      return { rows: Array(10).fill("row"), window };
    };

    const stream = new RowStream(loader, 10, { signal: controller.signal });

    await expect(stream.toArray()).rejects.toBeInstanceOf(RequestAbortedError);
    expect(callCount).toBe(1);
  });
});
