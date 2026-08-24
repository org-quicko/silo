import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { FsBlobStorage } from "../../adapters/blob/fs-blob-storage";
import { S3BlobStorage } from "../../adapters/blob/s3-blob-storage";
import { ProviderRegistry } from "../../plugins";

describe("FsBlobStorage", () => {
  let tempDir: string;
  let store: FsBlobStorage;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-blob-test-"));
    store = new FsBlobStorage(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("put and get blob", async () => {
    const data = new TextEncoder().encode("hello blob storage");
    await store.put("folder/test.txt", data);

    const exists = await store.exists("folder/test.txt");
    expect(exists).toBe(true);

    const res = await store.get("folder/test.txt");
    expect(res).not.toBeNull();
    expect(res!.size).toBe(data.length);
    expect(new TextDecoder().decode(res!.data)).toBe("hello blob storage");
  });

  test("get non-existent blob returns null", async () => {
    const res = await store.get("non-existent.txt");
    expect(res).toBeNull();
  });

  test("delete blob", async () => {
    const data = new TextEncoder().encode("delete me");
    await store.put("delete.txt", data);
    expect(await store.exists("delete.txt")).toBe(true);

    await store.delete("delete.txt");
    expect(await store.exists("delete.txt")).toBe(false);
  });

  test("list blobs with prefix", async () => {
    await store.put("images/a.png", new Uint8Array([1]));
    await store.put("images/b.png", new Uint8Array([2]));
    await store.put("docs/readme.md", new Uint8Array([3]));

    const allItems = await store.list();
    expect(allItems.length).toBe(3);

    const imageItems = await store.list("images/");
    expect(imageItems.length).toBe(2);
    expect(imageItems.map((i) => i.key).sort()).toEqual(["images/a.png", "images/b.png"]);
  });

  test("prevents key traversal outside base dir", async () => {
    expect(store.get("../../etc/passwd")).rejects.toThrow();
  });

});

describe("S3BlobStorage (Mock Client)", () => {
  test("delegates put, get, delete, list, exists to s3 client", async () => {
    const mockStorage = new Map<string, { data: Uint8Array; contentType?: string }>();

    const mockS3Client: any = {
      send: async (command: any) => {
        const cmdName = command.constructor.name;
        if (cmdName === "PutObjectCommand") {
          mockStorage.set(command.input.Key, {
            data: command.input.Body,
            contentType: command.input.ContentType,
          });
          return {};
        }
        if (cmdName === "GetObjectCommand") {
          const item = mockStorage.get(command.input.Key);
          if (!item) {
            const err: any = new Error("NoSuchKey");
            err.name = "NoSuchKey";
            throw err;
          }
          return {
            Body: {
              transformToByteArray: async () => item.data,
            },
            ContentType: item.contentType,
            ContentLength: item.data.length,
          };
        }
        if (cmdName === "DeleteObjectCommand") {
          mockStorage.delete(command.input.Key);
          return {};
        }
        if (cmdName === "ListObjectsV2Command") {
          const contents = Array.from(mockStorage.entries())
            .filter(([k]) => !command.input.Prefix || k.startsWith(command.input.Prefix))
            .map(([k, v]) => ({
              Key: k,
              Size: v.data.length,
              LastModified: new Date(),
            }));
          return { Contents: contents };
        }
        if (cmdName === "HeadObjectCommand") {
          if (!mockStorage.has(command.input.Key)) {
            const err: any = new Error("NotFound");
            err.name = "NotFound";
            throw err;
          }
          return {};
        }
        throw new Error(`Unhandled mock command ${cmdName}`);
      },
      destroy: () => {},
    };

    const s3Store = new S3BlobStorage({
      bucket: "test-bucket",
      s3Client: mockS3Client,
    });

    const data = new TextEncoder().encode("s3 content");
    await s3Store.put("file1.txt", data, { contentType: "text/plain" });

    expect(await s3Store.exists("file1.txt")).toBe(true);

    const fetched = await s3Store.get("file1.txt");
    expect(fetched).not.toBeNull();
    expect(fetched!.contentType).toBe("text/plain");
    expect(new TextDecoder().decode(fetched!.data)).toBe("s3 content");

    const list = await s3Store.list();
    expect(list.length).toBe(1);
    expect(list[0].key).toBe("file1.txt");

    await s3Store.delete("file1.txt");
    expect(await s3Store.exists("file1.txt")).toBe(false);
  });
});

describe("blob drivers through the provider registry (D31/§13.7)", () => {
  // The registry replaced BlobStorageFactory outright rather than wrapping it:
  // two places that both know how to build an S3 client is the second source of
  // truth D18 rejected for scopes and D28 for the version number.
  const registry = ProviderRegistry.withBuiltins();

  test("driver 'fs' builds FsBlobStorage", () => {
    expect(registry.openBlob({ driver: "fs", path: "/tmp/silo-test-blobs" }) instanceof FsBlobStorage).toBe(true);
  });

  test("driver 's3' builds S3BlobStorage", () => {
    const store = registry.openBlob({ driver: "s3", bucket: "my-bucket", region: "us-east-1" });
    expect(store instanceof S3BlobStorage).toBe(true);
  });

  test("an s3 driver with no bucket is refused", () => {
    expect(() => registry.openBlob({ driver: "s3" })).toThrow(/requires .bucket./);
  });

  test("an unknown driver names the ones that exist", () => {
    expect(() => registry.openBlob({ driver: "gcs" })).toThrow(/unknown blob storage driver "gcs".*fs, s3/s);
  });

  test("the built-in names are reserved and a plugin cannot take them", () => {
    // Shadowing "s3" would let an installed package silently become the store
    // an instance already has data in — a data-loss shape, not a naming clash.
    expect(() => registry.registerBlob("s3", () => ({}) as any, "evil-plugin")).toThrow(/reserved/);
    expect(() => registry.registerStorage("sqlite", (async () => ({})) as any, "evil-plugin")).toThrow(/reserved/);
  });
});
