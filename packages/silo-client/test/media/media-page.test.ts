import { describe, expect, test } from "bun:test";
import { MediaPage } from "../../src/media/media-page";
import { PageWindow } from "../../src/pagination/page-window";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

function setup() {
  const stubFetch = new StubFetch();
  const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
  return { stubFetch, transport };
}

const item = (id: string) => ({
  id,
  filename: `${id}.png`,
  folder: "",
  blob_key: `${id}.png`,
  size: 10,
  content_type: "image/png",
  hash: "abc",
  state: "active",
  tags: [],
  url: `http://localhost:8090/media/${id}`,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  usage_count: 0,
});

describe("MediaPage: navigation follows the echoed window, not the requested one", () => {
  test("requesting limit 900 but the server clamping to 500 makes next() use offset 500", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json({ items: [item("a")], total: 900, limit: 500, offset: 0 }));
    stubFetch.enqueue(StubResponse.json({ items: [item("b")], total: 900, limit: 500, offset: 500 }));

    const first = await MediaPage.loadWindow(transport, {}, new PageWindow(900, 0));
    expect(first.limit).toBe(500);
    expect(stubFetch.received[0].url).toContain("limit=900&offset=0");

    const second = await first.next();

    expect(stubFetch.received[1].url).toContain("limit=500&offset=500");
    expect(second?.files.map((asset) => asset.id)).toEqual(["b"]);
  });

  test("previous() is null before the start", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json({ items: [item("a")], total: 1, limit: 50, offset: 0 }));

    const page = await MediaPage.loadWindow(transport, {}, new PageWindow(50, 0));

    expect(await page.previous()).toBeNull();
    expect(stubFetch.received.length).toBe(1); // previous() made no second request
  });
});

describe("MediaPage: files and iteration", () => {
  test("files exposes the rows, and the page is iterable", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json({ items: [item("a"), item("b")], total: 2, limit: 50, offset: 0 }));

    const page = await MediaPage.loadWindow(transport, {}, new PageWindow(50, 0));

    expect(page.files.map((asset) => asset.id)).toEqual(["a", "b"]);
    expect([...page].map((asset) => asset.id)).toEqual(["a", "b"]);
    expect(page.hasMore).toBe(false);
  });
});

describe("MediaPage: wireQuery carries through to next()", () => {
  test("a folder filter set on the first request is repeated on next()", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json({ items: [item("a")], total: 2, limit: 1, offset: 0 }));
    stubFetch.enqueue(StubResponse.json({ items: [item("b")], total: 2, limit: 1, offset: 1 }));

    const first = await MediaPage.loadWindow(transport, { folder: "heroes/2026" }, new PageWindow(1, 0));
    await first.next();

    expect(stubFetch.received[1].url).toBe(
      "http://localhost:8090/api/media?folder=heroes%2F2026&limit=1&offset=1",
    );
  });
});
