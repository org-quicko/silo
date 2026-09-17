import { describe, expect, test } from "bun:test";
import { MediaInUseError } from "../../src/errors/media-in-use-error";
import { Media } from "../../src/media/media";
import { MediaReference } from "../../src/media/media-reference";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

/**
 * Every media example in the README, compiled and run against a stub
 * transport. Drives `Media` directly, which is what `silo.media` is.
 */
const assetPayload = (overrides: Record<string, unknown> = {}) => ({
  id: "01ASSET",
  filename: "hero.png",
  folder: "heroes",
  blob_key: "01ASSET.hero.png",
  size: 2048,
  content_type: "image/png",
  hash: "abc123",
  state: "active",
  tags: ["banner"],
  url: "http://localhost:8090/media/01ASSET",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  usage_count: 1,
  ...overrides,
});

test("the plan's Media section, end to end", async () => {
  const stubFetch = new StubFetch();
  const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
  const media = new Media(transport);

  // await silo.media.upload({ bytes, filename: "hero.png", contentType: "image/png", folder: "heroes" })
  const bytes = new Uint8Array([1, 2, 3]);
  stubFetch.enqueue(StubResponse.json(assetPayload({ id: "01UPLOAD1" }), 201));
  await media.upload({ bytes, filename: "hero.png", contentType: "image/png", folder: "heroes" });

  // await silo.media.upload(file, { folder: "heroes" })     // a browser File, or a Blob
  const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
  stubFetch.enqueue(StubResponse.json(assetPayload({ id: "01UPLOAD2" }), 201));
  await media.upload(file, { folder: "heroes" });

  // const library = await silo.media.list({ ... })
  stubFetch.enqueue(
    StubResponse.json(
      { items: [assetPayload({ id: "a" }), assetPayload({ id: "b" })], total: 3, limit: 50, offset: 0 },
      200,
    ),
  );
  const library = await media.list({
    text: "hero",
    folder: "heroes",
    recursive: true,
    extension: "png",
    tag: "banner",
    modifiedAfter: "2026-01-01",
    modifiedBefore: "2026-09-01",
    limit: 50,
    offset: 0,
    sort: "-updated_at",
  });
  expect(library.files.map((asset) => asset.id)).toEqual(["a", "b"]);
  expect(library.total).toBe(3);

  stubFetch.enqueue(StubResponse.json({ items: [assetPayload({ id: "c" })], total: 3, limit: 50, offset: 50 }, 200));
  const nextPage = await library.next();
  expect(nextPage?.files.map((asset) => asset.id)).toEqual(["c"]);

  // for await (const asset of silo.media.all({ folder: "heroes" })) { /* ... */ }
  stubFetch.enqueue(StubResponse.json({ items: [assetPayload({ id: "only" })], total: 1, limit: 50, offset: 0 }, 200));
  const seen: string[] = [];
  for await (const asset of media.all({ folder: "heroes" })) seen.push(asset.id);
  expect(seen).toEqual(["only"]);

  // await silo.media.extensions()
  stubFetch.enqueue(StubResponse.json({ items: ["png", "jpg"] }));
  expect(await media.extensions()).toEqual(["png", "jpg"]);

  // const asset = await silo.media.get(id)
  stubFetch.enqueue(StubResponse.json(assetPayload()));
  const asset = await media.get("01ASSET");
  expect(asset.url).toBe("http://localhost:8090/media/01ASSET");
  expect(asset.reference).toBe("silo://media/01ASSET");
  expect(asset.filename).toBe("hero.png");
  expect(asset.folder).toBe("heroes");
  expect(asset.sizeInBytes).toBe(2048);
  expect(asset.contentType).toBe("image/png");
  expect(asset.tags).toEqual(["banner"]);
  expect(asset.usageCount).toBe(1);

  // await asset.rename("hero-2.png")
  stubFetch.enqueue(StubResponse.json(assetPayload({ filename: "hero-2.png" })));
  await asset.rename("hero-2.png");
  expect(asset.filename).toBe("hero-2.png");

  // await asset.moveTo("heroes/2026")
  stubFetch.enqueue(StubResponse.json(assetPayload({ filename: "hero-2.png", folder: "heroes/2026" })));
  await asset.moveTo("heroes/2026");
  expect(asset.folder).toBe("heroes/2026");

  // await asset.setTags(["banner", "hero"])   // replaces the list, which is what PATCH does
  stubFetch.enqueue(StubResponse.json(assetPayload({ tags: ["banner", "hero"] })));
  await asset.setTags(["banner", "hero"]);
  expect(asset.tags).toEqual(["banner", "hero"]);

  // await asset.delete()                      // refused while an entry references it
  stubFetch.enqueue(
    StubResponse.errorBody(409, "media_in_use", "still referenced", {
      usage_count: 1,
      visible_count: 1,
      visible_capped: false,
      referrers: [],
    }),
  );
  await expect(asset.delete()).rejects.toBeInstanceOf(MediaInUseError);

  // await asset.delete({ force: true })       // also needs entries:update where it reaches
  stubFetch.enqueue(StubResponse.empty());
  await asset.delete({ force: true });

  // const usage = await asset.usages()
  stubFetch.enqueue(
    StubResponse.json({
      items: [{ media_id: "01ASSET", project: "acme", env: "prod", collection: "posts", entry_id: "01K1" }],
      total: 4,
      visible: 1,
      visible_capped: true,
    }),
  );
  const usage = await asset.usages();
  expect(usage.usages).toEqual([
    { mediaId: "01ASSET", project: "acme", environment: "prod", collection: "posts", entryId: "01K1" },
  ]);
  expect(usage.total).toBe(4);
  expect(usage.visible).toBe(1);
  expect(usage.visibleCapped).toBe(true);

  // MediaReference.idOf("silo://media/01J8...")     // "01J8..." | null
  expect(MediaReference.idOf(MediaReference.of(asset.id))).toBe(asset.id);

  // const report = await silo.media.deleteMany(ids, { force: true })
  stubFetch.enqueue(
    StubResponse.json({ deleted: ["a", "b"], failed: [{ id: "c", code: "not_found", message: "gone" }] }),
  );
  const report = await media.deleteMany(["a", "b", "c"], { force: true });
  expect(report.deleted).toEqual(["a", "b"]);
  expect(report.failed).toEqual([{ id: "c", code: "not_found", message: "gone" }]);

  // await silo.media.folders.list()
  stubFetch.enqueue(StubResponse.json({ items: ["heroes"] }));
  expect(await media.folders.list()).toEqual(["heroes"]);

  // await silo.media.folders.create("heroes/2026")
  stubFetch.enqueue(StubResponse.json({ path: "heroes/2026" }, 201));
  expect(await media.folders.create("heroes/2026")).toBe("heroes/2026");

  // await silo.media.folders.rename("heroes", "banners", { merge: true })
  stubFetch.enqueue(StubResponse.json({ from: "heroes", to: "banners" }));
  expect(await media.folders.rename("heroes", "banners", { merge: true })).toEqual({ from: "heroes", to: "banners" });

  // await silo.media.folders.delete("banners", { recursive: true, force: true })
  stubFetch.enqueue(StubResponse.empty());
  await media.folders.delete("banners", { recursive: true, force: true });
});
