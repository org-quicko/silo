import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { FsBlobStorage } from "../../src/adapters/blob/fs-blob-storage";
import { S3BlobStorage, type S3BlobStorageOptions } from "../../src/adapters/blob/s3-blob-storage";
import { S3MockServer } from "./s3-mock-server";
import { ProviderRegistry } from "../../src/plugins";

describe("FsBlobStorage", () => {
  let tempDir: string;
  let store: FsBlobStorage;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-blob-test-"));
    store = new FsBlobStorage(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("put and get blob", async () => {
    const data = new TextEncoder().encode("hello blob storage");
    await store.put("folder/test.txt", data);

    const exists = await store.exists("folder/test.txt");
    expect(exists).toBe(true);

    const response = await store.get("folder/test.txt");
    expect(response).not.toBeNull();
    expect(response!.size).toBe(data.length);
    expect(new TextDecoder().decode(response!.data)).toBe("hello blob storage");
  });

  test("get non-existent blob returns null", async () => {
    const response = await store.get("non-existent.txt");
    expect(response).toBeNull();
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
    expect(store.get("../../src/etc/passwd")).rejects.toThrow();
  });

});

describe("S3BlobStorage (against a mock S3 server)", () => {
  let s3: S3MockServer;

  const openStore = (overrides: Partial<S3BlobStorageOptions> = {}) =>
    new S3BlobStorage({
      bucket: S3MockServer.Bucket,
      endpoint: s3.endpoint,
      accessKeyId: "test",
      secretAccessKey: "test",
      forcePathStyle: true,
      ...overrides,
    });

  beforeEach(() => {
    s3 = S3MockServer.start();
  });

  afterEach(() => {
    s3.stop();
  });

  test("put, get, delete, list and exists round trip", async () => {
    const store = openStore();
    const data = new TextEncoder().encode("s3 content");
    await store.put("file1.txt", data, { contentType: "text/plain" });

    expect(await store.exists("file1.txt")).toBe(true);

    const fetched = await store.get("file1.txt");
    expect(fetched).not.toBeNull();
    expect(new TextDecoder().decode(fetched!.data)).toBe("s3 content");
    expect(fetched!.size).toBe(data.length);

    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0]!.key).toBe("file1.txt");
    expect(list[0]!.size).toBe(data.length);
    expect(list[0]!.lastModified).toBeInstanceOf(Date);

    await store.delete("file1.txt");
    expect(await store.exists("file1.txt")).toBe(false);
  });

  test("put sends the content type through to the object", async () => {
    const store = openStore();
    await store.put("photo.png", new Uint8Array([1, 2, 3]), { contentType: "image/png" });
    expect(s3.objects.get("photo.png")!.contentType).toBe("image/png");
  });

  test("get reports the content type its key implies, matching FsBlobStorage", async () => {
    const store = openStore();
    await store.put("01ARZ3.png", new Uint8Array([1]), { contentType: "image/png" });
    expect((await store.get("01ARZ3.png"))!.contentType).toBe("image/png");
  });

  test("get of a missing key is null, not a throw", async () => {
    expect(await openStore().get("absent.txt")).toBeNull();
  });

  test("delete of a missing key is not an error", async () => {
    expect(await openStore().delete("absent.txt")).toBeUndefined();
  });

  test("list filters by prefix", async () => {
    const store = openStore();
    await store.put("images/a.png", new Uint8Array([1]));
    await store.put("images/b.png", new Uint8Array([2]));
    await store.put("docs/readme.md", new Uint8Array([3]));

    expect((await store.list()).length).toBe(3);
    expect((await store.list("images/")).map((i) => i.key).sort()).toEqual(["images/a.png", "images/b.png"]);
  });

  // The adapter this replaced issued exactly one ListObjectsV2 and returned
  // whatever came back, so a bucket holding more than a page of media exported
  // a silently truncated library — `Exporter.exportDir` walks `list()` to
  // decide which bytes go into the archive.
  test("list follows continuation tokens past a single page", async () => {
    const store = openStore();
    s3.maxKeysPerPage = 3;
    for (let i = 0; i < 10; i++) {
      await store.put(`media/${String(i).padStart(2, "0")}.png`, new Uint8Array([i]));
    }

    const listed = await store.list("media/");
    expect(listed.length).toBe(10);
    expect(listed.map((i) => i.key)).toEqual(
      Array.from({ length: 10 }, (_, i) => `media/${String(i).padStart(2, "0")}.png`)
    );
    expect(s3.requests.filter((r) => r.includes("list-type=2")).length).toBe(4);
  });

  // Bun names the addressing mode as the positive of the one the AWS SDK names
  // and defaults it the other way, so an unmapped option would repoint every
  // existing deployment. These two pin the mapping in both directions.
  test("no force_path_style addresses the bucket virtual-hosted, as the AWS SDK did", async () => {
    await openStore({ forcePathStyle: undefined }).put("a.png", new Uint8Array([1]));
    expect(s3.requests[0]).toBe("PUT /a.png");
  });

  test("force_path_style puts the bucket in the path", async () => {
    await openStore({ forcePathStyle: true }).put("a.png", new Uint8Array([1]));
    expect(s3.requests[0]).toBe(`PUT /${S3MockServer.Bucket}/a.png`);
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
