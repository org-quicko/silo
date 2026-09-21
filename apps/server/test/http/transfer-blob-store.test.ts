import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { MediaRef } from "@silo/shared/media-ref";
import type {
  BlobGetResult,
  BlobItem,
  BlobPutOptions,
  BlobStorage,
} from "../../src/core/ports/blob-storage";

/**
 * A stand-in for a configured store — S3 in production, this in a test. It
 * records what it was asked to hold, which is the only way to tell "the bytes
 * went where the instance is configured to put them" from "the bytes went to
 * whatever directory the transfer code happened to construct".
 */
class RecordingBlobStorage implements BlobStorage {
  readonly blobs = new Map<string, Uint8Array>();
  readonly puts: string[] = [];

  async put(key: string, data: Uint8Array, _options?: BlobPutOptions): Promise<void> {
    this.puts.push(key);
    this.blobs.set(key, data);
  }

  async get(key: string): Promise<BlobGetResult | null> {
    const data = this.blobs.get(key);
    return data ? { data, size: data.byteLength } : null;
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }

  async list(): Promise<BlobItem[]> {
    return [...this.blobs].map(([key, data]) => ({ key, size: data.byteLength }));
  }

  async exists(key: string): Promise<boolean> {
    return this.blobs.has(key);
  }

  publicRoot(): string | null {
    return "https://bucket.example.com";
  }
}

/**
 * Where a transfer puts media (D45): into the store the **instance** is
 * configured with, never into a directory derived from the data path.
 *
 * Worth pinning rather than reading off the call sites, because every transfer
 * entry point takes a `BlobStorage | string` and the string branch builds an
 * `FsBlobStorage`. One caller passing a path instead of the live store would
 * send an import's media to local disk on an S3 instance, and nothing would
 * say so until the URLs stopped resolving.
 */
describe("transfers write media to the configured store", () => {
  let tempDir: string;
  let sourceStore: SqliteStore;
  let sourceService: SiloService;
  let sourceBlobs: RecordingBlobStorage;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-blob-target-"));
    sourceStore = await SqliteStore.open(path.join(tempDir, "source.db"));
    sourceBlobs = new RecordingBlobStorage();
    sourceService = new SiloService(sourceStore, { blobStorage: sourceBlobs });

    await sourceService.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });
    const asset = await sourceService.media.save(
      "photo.png",
      new TextEncoder().encode("the bytes")
    );
    await sourceService.entries.create(Scope.Default, "posts", {
      cover: MediaRef.url(asset.id),
    });
  });

  afterEach(async () => {
    await sourceStore.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  /** A destination whose media directory would exist if anything wrote to it. */
  const destination = async (name: string) => {
    const store = await SqliteStore.open(path.join(tempDir, `${name}.db`));
    const blobs = new RecordingBlobStorage();
    const mediaDir = path.join(tempDir, `${name}-media`);
    return {
      store,
      blobs,
      mediaDir,
      service: new SiloService(store, { blobStorage: blobs, mediaDir }),
    };
  };

  /** Whether anything landed on local disk despite a configured store. */
  const wroteToDisk = async (mediaDir: string): Promise<boolean> => {
    try {
      return (await fs.readdir(mediaDir)).length > 0;
    } catch {
      return false;
    }
  };

  test("an export reads the bytes from the configured store", async () => {
    const archive = path.join(tempDir, "export-dir");
    const manifest = await sourceService.transfer.exportDir(archive, {});

    expect(manifest.media?.files).toBe(1);
    expect((await fs.readdir(path.join(archive, "media"))).length).toBe(1);
  });

  test("an import writes them into the destination's configured store", async () => {
    const archive = path.join(tempDir, "for-import");
    await sourceService.transfer.exportDir(archive, {});

    const target = await destination("import");
    try {
      const result = await target.service.transfer.importDir(archive, { mode: "merge" });

      expect(result.media?.files).toBe(1);
      expect(target.blobs.puts.length).toBe(1);
      expect([...target.blobs.blobs.values()][0]).toEqual(
        new TextEncoder().encode("the bytes")
      );
      // The local directory the fs driver would have used stays empty.
      expect(await wroteToDisk(target.mediaDir)).toBe(false);
    } finally {
      await target.store.close();
    }
  });

  test("a streamed import does too, which is the path a copy takes", async () => {
    // `POST /api/copy` pulls the source's export and hands that stream to
    // `importTarGzStream`, so pinning the stream path pins the copy path.
    const archivePath = path.join(tempDir, "archive.tar.gz");
    await sourceService.transfer.exportTarGz(archivePath, {});
    const bytes = await fs.readFile(archivePath);

    const target = await destination("copy");
    try {
      const stream = new Response(bytes).body!;
      const result = await target.service.transfer.importTarGzStream(stream, { mode: "merge" });

      expect(result.media?.files).toBe(1);
      expect(target.blobs.puts.length).toBe(1);
      expect(await wroteToDisk(target.mediaDir)).toBe(false);

      // And the restored asset is readable through the service, so the catalog
      // and the store agree about where the bytes are.
      const restored = await target.service.media.list();
      expect(restored.total).toBe(1);
      const fetched = await target.service.media.bytes(restored.items[0]!.id);
      expect(fetched!.data).toEqual(new TextEncoder().encode("the bytes"));
    } finally {
      await target.store.close();
    }
  });

  test("replace mode clears the configured store, not a directory", async () => {
    const archive = path.join(tempDir, "for-replace");
    await sourceService.transfer.exportDir(archive, {});

    const target = await destination("replace");
    try {
      await target.service.media.save("stale.png", new TextEncoder().encode("gone"));
      expect(target.blobs.blobs.size).toBe(1);

      const result = await target.service.transfer.importDir(archive, { mode: "replace" });

      expect(result.media?.cleared).toBe(true);
      expect(target.blobs.blobs.size).toBe(1);
      expect([...target.blobs.blobs.values()][0]).toEqual(
        new TextEncoder().encode("the bytes")
      );
      expect(await wroteToDisk(target.mediaDir)).toBe(false);
    } finally {
      await target.store.close();
    }
  });
});
