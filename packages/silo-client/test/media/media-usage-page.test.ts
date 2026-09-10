import { describe, expect, test } from "bun:test";
import { MediaUsagePage } from "../../src/media/media-usage-page";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

function setup() {
  const stubFetch = new StubFetch();
  const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
  return { stubFetch, transport };
}

const usageRow = (entryId: string) => ({
  media_id: "01J8",
  project: "acme",
  env: "prod",
  collection: "posts",
  entry_id: entryId,
});

describe("MediaUsagePage: request shape", () => {
  test("sends limit and offset as given", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json({ items: [], total: 5, visible: 5, visible_capped: false }));

    await MediaUsagePage.load(transport, "01J8", { limit: 10, offset: 20 });

    expect(stubFetch.received[0].method).toBe("GET");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/01J8/usages?limit=10&offset=20");
  });

  test("defaults limit and offset when the query is empty", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json({ items: [], total: 0, visible: 0, visible_capped: false }));

    await MediaUsagePage.load(transport, "01J8", {});

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/01J8/usages?limit=50&offset=0");
  });
});

describe("MediaUsagePage: total, visible and visibleCapped", () => {
  test("exposes all three, and every row mapped through MediaAssetMapper", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(
      StubResponse.json({ items: [usageRow("01K1")], total: 40, visible: 12, visible_capped: true }),
    );

    const page = await MediaUsagePage.load(transport, "01J8", { limit: 5, offset: 0 });

    expect(page.total).toBe(40);
    expect(page.visible).toBe(12);
    expect(page.visibleCapped).toBe(true);
    expect(page.usages).toEqual([
      { mediaId: "01J8", project: "acme", environment: "prod", collection: "posts", entryId: "01K1" },
    ]);
  });
});

describe("MediaUsagePage: pageCount/hasMore derive from visible, not total", () => {
  test("a page full at the visible ceiling reports no more, even though total is far larger", async () => {
    const { transport, stubFetch } = setup();
    stubFetch.enqueue(
      StubResponse.json({
        items: [usageRow("a"), usageRow("b"), usageRow("c"), usageRow("d"), usageRow("e")],
        total: 400,
        visible: 5,
        visible_capped: true,
      }),
    );

    const page = await MediaUsagePage.load(transport, "01J8", { limit: 5, offset: 0 });

    expect(page.total).toBe(400);
    expect(page.hasMore).toBe(false); // 0 + 5 rows === visible (5), not total (400)
    expect(page.pageCount).toBe(1);
  });

  test("hasMore is true while rows fall short of visible", async () => {
    const { transport, stubFetch } = setup();
    stubFetch.enqueue(
      StubResponse.json({
        items: [usageRow("a"), usageRow("b"), usageRow("c"), usageRow("d"), usageRow("e")],
        total: 40,
        visible: 12,
        visible_capped: false,
      }),
    );

    const page = await MediaUsagePage.load(transport, "01J8", { limit: 5, offset: 0 });

    expect(page.hasMore).toBe(true); // 0 + 5 < visible (12)
    expect(page.pageCount).toBe(3); // ceil(12 / 5)
  });
});

describe("MediaUsagePage: next()/previous() build the window themselves", () => {
  test("next() advances by the requested limit, since none is echoed", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(
      StubResponse.json({
        items: [usageRow("a"), usageRow("b"), usageRow("c"), usageRow("d"), usageRow("e")],
        total: 40,
        visible: 12,
        visible_capped: false,
      }),
    );
    stubFetch.enqueue(StubResponse.json({ items: [], total: 40, visible: 12, visible_capped: false }));

    const first = await MediaUsagePage.load(transport, "01J8", { limit: 5, offset: 0 });
    await first.next();

    expect(stubFetch.received[1].url).toBe("http://localhost:8090/api/media/01J8/usages?limit=5&offset=5");
  });

  test("previous() is null before the start", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json({ items: [], total: 0, visible: 0, visible_capped: false }));

    const page = await MediaUsagePage.load(transport, "01J8", { limit: 5, offset: 0 });

    expect(await page.previous()).toBeNull();
  });
});
