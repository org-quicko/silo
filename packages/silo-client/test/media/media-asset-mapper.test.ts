import { describe, expect, test } from "bun:test";
import { MediaAssetMapper } from "../../src/media/media-asset-mapper";
import type { MediaAssetPayload } from "../../src/media/media-asset-payload";

const payload: MediaAssetPayload = {
  id: "01J8",
  filename: "hero.png",
  folder: "heroes",
  blob_key: "01J8.hero.png",
  size: 1024,
  content_type: "image/png",
  hash: "abc123",
  state: "active",
  tags: ["banner", "hero"],
  url: "http://localhost:8090/media/01J8",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  usage_count: 3,
};

describe("MediaAssetMapper.toRecord", () => {
  test("renames only the known fields", () => {
    expect(MediaAssetMapper.toRecord(payload)).toEqual({
      id: "01J8",
      filename: "hero.png",
      folder: "heroes",
      blobKey: "01J8.hero.png",
      sizeInBytes: 1024,
      contentType: "image/png",
      hash: "abc123",
      state: "active",
      tags: ["banner", "hero"],
      url: "http://localhost:8090/media/01J8",
      usageCount: 3,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
  });

  test("filename and tags pass through byte for byte", () => {
    const record = MediaAssetMapper.toRecord(payload);
    expect(record.filename).toBe(payload.filename);
    expect(record.tags).toEqual(payload.tags);
  });

  test("usage_count defaults to 0 when absent", () => {
    const { usage_count: _usageCount, ...rest } = payload;
    expect(MediaAssetMapper.toRecord(rest as MediaAssetPayload).usageCount).toBe(0);
  });

  test("never invents camelCase for an unknown key", () => {
    const withExtra = { ...payload, product_code: "X1" } as MediaAssetPayload & { product_code: string };
    const record = MediaAssetMapper.toRecord(withExtra);
    expect((record as unknown as Record<string, unknown>).productCode).toBeUndefined();
    expect((record as unknown as Record<string, unknown>).product_code).toBeUndefined();
  });
});

describe("MediaAssetMapper.toUsage", () => {
  test("maps env to environment and the rest 1:1", () => {
    expect(
      MediaAssetMapper.toUsage({
        media_id: "01J8",
        project: "acme",
        env: "prod",
        collection: "posts",
        entry_id: "01K1",
      }),
    ).toEqual({ mediaId: "01J8", project: "acme", environment: "prod", collection: "posts", entryId: "01K1" });
  });

  test("reads defensively when a field is missing or the wrong type", () => {
    expect(MediaAssetMapper.toUsage({})).toEqual({
      mediaId: "",
      project: "",
      environment: "",
      collection: "",
      entryId: "",
    });
  });
});

describe("MediaAssetMapper.toUsagePage", () => {
  test("maps visible_capped and every row", () => {
    const page = MediaAssetMapper.toUsagePage({
      items: [{ media_id: "01J8", project: "acme", env: "prod", collection: "posts", entry_id: "01K1" }],
      total: 5,
      visible: 1,
      visible_capped: true,
    });
    expect(page.total).toBe(5);
    expect(page.visible).toBe(1);
    expect(page.visibleCapped).toBe(true);
    expect(page.items).toEqual([
      { mediaId: "01J8", project: "acme", environment: "prod", collection: "posts", entryId: "01K1" },
    ]);
  });
});
