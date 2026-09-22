import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { MediaPaths } from "../../src/core/media/media-paths";

/**
 * Moving assets off a pre-D88 key (D88).
 *
 * The old keys still resolve, so this is an optimisation rather than a
 * migration — what it buys is that the store holding the object can answer
 * `/media/<id>` itself. What it must never do is lose bytes, which is why the
 * order is copy, repoint, remove, and why running it twice is a no-op.
 */
describe("silo media rekey", () => {
  let tempDir: string;
  let store: SqliteStore;
  let mediaDir: string;
  let service: SiloService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-rekey-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    mediaDir = path.join(tempDir, "media");
    service = new SiloService(store, { mediaDir });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /** An asset as it would have been written before D88: bytes under
   *  `<id><ext>`, and a record naming that key. */
  const legacyAsset = async (filename: string, bytes: string) => {
    const asset = await service.media.save(filename, new TextEncoder().encode(bytes));
    const legacyKey = `${asset.id}${path.extname(filename)}`;

    await service.blobStorage.put(legacyKey, new TextEncoder().encode(bytes));
    await service.blobStorage.delete(asset.blob_key);
    const entry = await store.get(Scope.System, "_media", asset.id);
    // `search: null` is what `_media` always passes -- system data is never
    // indexed by text.
    await store.put(
      { ...entry, data: { ...entry.data, blob_key: legacyKey } },
      { usages: [], search: null }
    );

    return { id: asset.id, legacyKey };
  };

  test("moves a pre-D88 asset onto media/<id> and removes the old object", async () => {
    const { id, legacyKey } = await legacyAsset("photo.png", "png-bytes");

    const result = await service.media.rekey();

    expect(result.moved).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.failed).toEqual([]);

    // The bytes are on the new key, the old object is gone, and the record
    // agrees with both.
    expect(await service.blobStorage.exists(MediaPaths.blobKey(id))).toBe(true);
    expect(await service.blobStorage.exists(legacyKey)).toBe(false);
    expect((await service.media.get(id)).blob_key).toBe(MediaPaths.blobKey(id));

    // And it still serves, by the URL it always had.
    expect(await service.media.bytes(id)).not.toBeNull();
  });

  test("running it again changes nothing", async () => {
    await legacyAsset("photo.png", "png-bytes");
    await service.media.rekey();

    const second = await service.media.rekey();

    expect(second.moved).toBe(0);
    expect(second.removed).toBe(0);
    expect(second.current).toBe(1);
    expect(second.failed).toEqual([]);
  });

  test("an interrupted run resumes: a copy already made is not made twice", async () => {
    const { id, legacyKey } = await legacyAsset("photo.png", "png-bytes");

    // What a crash between the copy and the repoint leaves: both objects
    // present, the record still naming the old one.
    await service.blobStorage.put(MediaPaths.blobKey(id), new TextEncoder().encode("png-bytes"));

    const result = await service.media.rekey();

    expect(result.moved).toBe(1);
    expect(result.removed).toBe(1);
    expect(await service.blobStorage.exists(legacyKey)).toBe(false);
    expect((await service.media.get(id)).blob_key).toBe(MediaPaths.blobKey(id));
  });

  test("a record whose bytes are gone is counted and left for reconcile", async () => {
    const { id, legacyKey } = await legacyAsset("photo.png", "png-bytes");
    await service.blobStorage.delete(legacyKey);

    const result = await service.media.rekey();

    expect(result.missing).toBe(1);
    expect(result.moved).toBe(0);
    // Untouched: dropping a record is reconcile's judgement, not a migration's.
    expect((await service.media.get(id)).blob_key).toBe(legacyKey);
  });

  test("an asset already on the new key is left alone", async () => {
    const asset = await service.media.save("photo.png", new TextEncoder().encode("png-bytes"));

    const result = await service.media.rekey();

    expect(result.current).toBe(1);
    expect(result.moved).toBe(0);
    expect((await service.media.get(asset.id)).blob_key).toBe(MediaPaths.blobKey(asset.id));
  });
});
