import { describe, expect, test } from "bun:test";
import { MediaInUseError } from "../../src/errors/media-in-use-error";
import { MediaAsset } from "../../src/media/media-asset";
import type { MediaAssetRecord } from "../../src/media/media-asset";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

const record: MediaAssetRecord = {
  id: "01J8",
  filename: "hero.png",
  folder: "heroes",
  blobKey: "01J8.hero.png",
  sizeInBytes: 1024,
  contentType: "image/png",
  hash: "abc123",
  state: "active",
  tags: ["banner"],
  url: "http://localhost:8090/media/01J8",
  usageCount: 0,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const assetPayload = (overrides: Record<string, unknown> = {}) => ({
  id: "01J8",
  filename: "hero.png",
  folder: "heroes",
  blob_key: "01J8.hero.png",
  size: 1024,
  content_type: "image/png",
  hash: "abc123",
  state: "active",
  tags: ["banner"],
  url: "http://localhost:8090/media/01J8",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  usage_count: 0,
  ...overrides,
});

function setup() {
  const stubFetch = new StubFetch();
  const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
  return { stubFetch, transport };
}

describe("MediaAsset: reference vs url", () => {
  test("reference is silo://media/<id>, distinct from url", () => {
    const { transport } = setup();
    const asset = new MediaAsset(transport, record);
    expect(asset.reference).toBe("silo://media/01J8");
    expect(asset.url).toBe(record.url);
    expect(asset.reference).not.toBe(asset.url);
  });
});

describe("MediaAsset: rename", () => {
  test("sends PATCH {filename} and adopts the response in place, returning this", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json(assetPayload({ filename: "hero-2.png" })));
    const asset = new MediaAsset(transport, record);

    const result = await asset.rename("hero-2.png");

    expect(stubFetch.received[0].method).toBe("PATCH");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/01J8");
    expect(JSON.parse(stubFetch.received[0].body ?? "")).toEqual({ filename: "hero-2.png" });
    expect(result).toBe(asset);
    expect(asset.filename).toBe("hero-2.png");
  });
});

describe("MediaAsset: moveTo", () => {
  test("sends PATCH {folder}", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json(assetPayload({ folder: "heroes/2026" })));
    const asset = new MediaAsset(transport, record);

    await asset.moveTo("heroes/2026");

    expect(JSON.parse(stubFetch.received[0].body ?? "")).toEqual({ folder: "heroes/2026" });
    expect(asset.folder).toBe("heroes/2026");
  });
});

describe("MediaAsset: setTags replaces, it does not append", () => {
  test("sends PATCH {tags} with exactly the given list and adopts the response", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json(assetPayload({ tags: ["banner", "hero"] })));
    const asset = new MediaAsset(transport, record);

    await asset.setTags(["banner", "hero"]);

    expect(JSON.parse(stubFetch.received[0].body ?? "")).toEqual({ tags: ["banner", "hero"] });
    expect(asset.tags).toEqual(["banner", "hero"]);
  });
});

describe("MediaAsset: delete", () => {
  test("plain delete sends no force query param", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.empty());
    const asset = new MediaAsset(transport, record);

    await asset.delete();

    expect(stubFetch.received[0].method).toBe("DELETE");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/01J8");
  });

  test("{ force: true } sends ?force=true, and only the literal string counts server-side", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.empty());
    const asset = new MediaAsset(transport, record);

    await asset.delete({ force: true });

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/01J8?force=true");
  });

  test("a 409 media_in_use raises MediaInUseError with mapped referrers", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(
      StubResponse.errorBody(409, "media_in_use", "still referenced", {
        usage_count: 2,
        visible_count: 1,
        visible_capped: false,
        referrers: [{ media_id: "01J8", project: "acme", env: "prod", collection: "posts", entry_id: "01K1" }],
      }),
    );
    const asset = new MediaAsset(transport, record);

    const caught: unknown = await asset.delete().then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(MediaInUseError);
    const error = caught as MediaInUseError;
    expect(error.usageCount).toBe(2);
    expect(error.visibleCount).toBe(1);
    expect(error.visibleCapped).toBe(false);
    expect(error.referrers).toEqual([
      { mediaId: "01J8", project: "acme", environment: "prod", collection: "posts", entryId: "01K1" },
    ]);
  });
});

describe("MediaAsset: usages", () => {
  test("GET /api/media/{id}/usages, defaulting limit/offset", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json({ items: [], total: 0, visible: 0, visible_capped: false }));
    const asset = new MediaAsset(transport, record);

    const page = await asset.usages();

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/01J8/usages?limit=50&offset=0");
    expect(page.usages).toEqual([]);
  });
});

describe("MediaAsset: refresh", () => {
  test("re-reads and adopts the response in place, returning this", async () => {
    const { stubFetch, transport } = setup();
    stubFetch.enqueue(StubResponse.json(assetPayload({ filename: "renamed-elsewhere.png" })));
    const asset = new MediaAsset(transport, record);

    const result = await asset.refresh();

    expect(stubFetch.received[0].method).toBe("GET");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/01J8");
    expect(result).toBe(asset);
    expect(asset.filename).toBe("renamed-elsewhere.png");
  });
});

describe("MediaAsset: toJSON", () => {
  test("is the plain mapped record", () => {
    const { transport } = setup();
    const asset = new MediaAsset(transport, record);
    expect(asset.toJSON()).toEqual(record);
  });
});
