import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import { ByteRange } from "../../src/core/media/byte-range";

/**
 * `GET /media/{id}` sends an asset as a body the runtime reads as it goes, and
 * honours a `Range` (D80). Before this the whole file was read into memory and
 * copied once more per request, anonymously, with the largest asset one
 * `?sort=-size` away — the 2026-09-18 audit's C3.
 */
describe("media delivery streams and honours ranges", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let id: string;
  let hash: string;
  const content = "0123456789abcdef";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-delivery-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    app = new SiloServer(service, {
      version: "test",
      authDisabled: true,
      logger: Logger.silent(),
    }).build();
    const asset = await service.media.save("clip.mp4", new TextEncoder().encode(content));
    id = asset.id;
    hash = asset.hash;
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("a plain GET answers the whole asset with its length and advertises ranges", async () => {
    const response = await app.request(`/media/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("etag")).toBe(`"${hash}"`);
    // A `Blob` body: the listener states its length when it sends, which
    // `app.request` does not do, so the body is what proves the size here.
    expect(await response.text()).toBe(content);
  });

  test("a Range answers 206 with exactly that span and the whole size", async () => {
    const response = await app.request(`/media/${id}`, { headers: { range: "bytes=4-7" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 4-7/${content.length}`);
    expect(await response.text()).toBe("4567");
  });

  test("an open-ended and a suffix range are clamped to the object", async () => {
    const tail = await app.request(`/media/${id}`, { headers: { range: "bytes=12-" } });
    expect(tail.status).toBe(206);
    expect(await tail.text()).toBe("cdef");

    const suffix = await app.request(`/media/${id}`, { headers: { range: "bytes=-3" } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe(`bytes 13-15/${content.length}`);
    expect(await suffix.text()).toBe("def");

    const past = await app.request(`/media/${id}`, { headers: { range: "bytes=10-999" } });
    expect(past.status).toBe(206);
    expect(await past.text()).toBe("abcdef");
  });

  test("a range wholly past the end is 416 naming the size", async () => {
    const response = await app.request(`/media/${id}`, { headers: { range: "bytes=99-" } });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${content.length}`);
  });

  test("a malformed or multi-part Range is ignored and the whole object served", async () => {
    for (const range of ["bytes=0-3,5-7", "items=0-3", "bytes=7-3", "bytes=-"]) {
      const response = await app.request(`/media/${id}`, { headers: { range } });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(content);
    }
  });

  test("If-None-Match still wins over a Range", async () => {
    const response = await app.request(`/media/${id}`, {
      headers: { range: "bytes=0-3", "if-none-match": `"${hash}"` },
    });
    expect(response.status).toBe(304);
  });

  test("the parser reads the three single-range forms and nothing else", () => {
    expect(ByteRange.parse("bytes=0-99")).toEqual({ kind: "from", start: 0, end: 99 });
    expect(ByteRange.parse("bytes=500-")).toEqual({ kind: "from", start: 500 });
    expect(ByteRange.parse("bytes=-500")).toEqual({ kind: "suffix", length: 500 });
    expect(ByteRange.parse(undefined)).toBeNull();
    expect(ByteRange.parse("bytes=0-1,2-3")).toBeNull();
    expect(ByteRange.parse("bytes=9-1")).toBeNull();

    expect(ByteRange.resolve({ kind: "from", start: 0, end: 99 }, 10)).toEqual({ start: 0, end: 9 });
    expect(ByteRange.resolve({ kind: "from", start: 10 }, 10)).toBeNull();
    expect(ByteRange.resolve({ kind: "suffix", length: 50 }, 10)).toEqual({ start: 0, end: 9 });
    expect(ByteRange.resolve({ kind: "suffix", length: 0 }, 10)).toBeNull();
  });
});
