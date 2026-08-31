import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { MediaRef } from "@silo/shared/media-ref";
import { MediaResolver } from "../../src/core/media/media-resolver";

/**
 * `MediaLinkResolver` and `MediaResolver` together (D48): a reference that
 * was looked up in the catalog and found nothing resolves to `null`, and one
 * that was never looked up resolves exactly as it always has.
 *
 * `service.media.links` is the real entry point every route uses
 * (`MediaService.links`), so these go through it rather than instantiating
 * `MediaLinkResolver` directly.
 */
describe("media field resolution: null when a reference does not resolve (D48)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  const baseUrl = "http://localhost:8090";

  const schema = {
    type: "object",
    properties: {
      cover: { type: "string", "x-silo-type": "media" },
      gallery: { type: "array", items: { type: "string", "x-silo-type": "media" } },
    },
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-link-resolver-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("a force-deleted asset's field resolves to null, in server mode (the default) too", async () => {
    const asset = await service.media.save("hero.png", new TextEncoder().encode("bytes"));
    await service.media.delete(asset.id, { force: true });

    const data = { cover: MediaRef.url(asset.id) };
    const links = await service.media.links(baseUrl, data);
    const resolved = MediaResolver.resolveMediaFields(data, schema, links);

    expect(resolved.cover).toBeNull();
  });

  test("an array element that does not resolve is nulled in place, never shortening the array", async () => {
    const present = await service.media.save("keep.png", new TextEncoder().encode("bytes"));
    const gone = await service.media.save("gone.png", new TextEncoder().encode("bytes"));
    await service.media.delete(gone.id, { force: true });

    const data = { gallery: [MediaRef.url(present.id), MediaRef.url(gone.id)] };
    const links = await service.media.links(baseUrl, data);
    const resolved = MediaResolver.resolveMediaFields(data, schema, links);

    expect(resolved.gallery).toHaveLength(2);
    expect(resolved.gallery[0]).toBe(`${baseUrl}/media/${present.id}`);
    expect(resolved.gallery[1]).toBeNull();
  });

  test("a legacy blob reference is never looked up, and so is never nulled", async () => {
    // Not in the catalog at all — if this were ever looked up it would come
    // back absent, and a legacy ref must resolve regardless.
    const data = { cover: "/media/abc123_legacy.png" };
    const links = await service.media.links(baseUrl, data);
    const resolved = MediaResolver.resolveMediaFields(data, schema, links);

    expect(resolved.cover).toBe(`${baseUrl}/media/abc123_legacy.png`);
  });

  test("an id past the lookup cap is never asked about, and resolves as before", async () => {
    // MediaLinkResolver caps a response at 200 lookups. MediaRefs.extract
    // sorts its output, so zero-padded ids sort in the same order they were
    // generated, and the 201st (index 200) is the one the cap drops.
    const ids = Array.from({ length: 201 }, (_, index) => `id-${String(index).padStart(3, "0")}`);
    const data = { gallery: ids.map((id) => MediaRef.url(id)) };
    const links = await service.media.links(baseUrl, data);
    const resolved = MediaResolver.resolveMediaFields(data, schema, links);

    // Within the cap: asked, and absent from a catalog that never held it.
    expect(resolved.gallery[0]).toBeNull();
    // Past the cap: never asked, so it produces a URL exactly as it always
    // would have before this asset was ever consulted.
    expect(resolved.gallery[200]).toBe(`${baseUrl}/media/id-200`);
  });

  test("an asset stuck in `deleting` still has a record, so it still resolves", async () => {
    const asset = await service.media.save("stuck.png", new TextEncoder().encode("bytes"));
    service.blobStorage.delete = async () => {
      throw new Error("AccessDenied");
    };
    await expect(service.media.delete(asset.id, { force: true })).rejects.toThrow();
    expect((await service.media.get(asset.id)).state).toBe("deleting");

    const data = { cover: MediaRef.url(asset.id) };
    const links = await service.media.links(baseUrl, data);
    const resolved = MediaResolver.resolveMediaFields(data, schema, links);

    expect(resolved.cover).toBe(`${baseUrl}/media/${asset.id}`);
  });
});
