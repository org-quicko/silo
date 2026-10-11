import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { MediaCatalog } from "../../src/core/media/media-catalog";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import { ZipEntries } from "./support/zip-entries";

interface ArchiveBody {
  files: number;
  bytes: number;
  parts: Array<{ part: number; filename: string; files: number; bytes: number; url: string }>;
  separate: Array<{ id: string; filename: string; size: number; url: string }>;
}

const GiB = 1024 ** 3;

describe("bulk media download (D106)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let key: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-archives-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
    key = (await service.keys.create("reader", [])).secret;
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const bytes = (text: string) => new TextEncoder().encode(text);
  const text = (data: Uint8Array | null | undefined) => new TextDecoder().decode(data ?? new Uint8Array());

  const prepare = (selection: unknown, secret: string | null = key) =>
    app.request("/api/media/archives", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify(selection),
    });

  const prepared = async (selection: unknown): Promise<ArchiveBody> => {
    const response = await prepare(selection);
    expect(response.status).toBe(201);
    return (await response.json()) as ArchiveBody;
  };

  const download = async (url: string) => {
    const response = await app.request(url);
    expect(response.status).toBe(200);
    return ZipEntries.read(new Uint8Array(await response.arrayBuffer()));
  };

  /** A catalog record with no bytes behind it, for sizes no test should write. */
  const record = async (filename: string, size: number) => {
    const id = EntryUtils.newID();
    const now = EntryUtils.now();
    await store.put(
      {
        id,
        project: Scope.System.project,
        env: Scope.System.env,
        collection: MediaCatalog.Collection,
        rev: 1,
        seq: 0,
        created_at: now,
        updated_at: now,
        data: { filename, folder: "", blob_key: `media/${id}`, size, content_type: "video/mp4", hash: "", state: "active", tags: [] },
      },
      { usages: [], search: null }
    );
    return id;
  };

  test("a folder keeps its tree and empty subfolders, a file lands at the root, and names never collide", async () => {
    await service.media.save("hero.png", bytes("first"), "/site/banners");
    await service.media.save("hero.png", bytes("second"), "/site/banners");
    await service.media.save("about.txt", bytes("about"), "/site");
    await service.media.createFolder("/site/drafts/old");
    const logo = await service.media.save("logo.svg", bytes("<svg/>"), "/brand");
    const otherLogo = await service.media.save("logo.svg", bytes("<svg></svg>"), "/brand/v2");

    const body = await prepared({ folders: ["/site"], ids: [logo.id, otherLogo.id] });
    expect(body.files).toBe(5);
    expect(body.parts).toHaveLength(1);
    expect(body.parts[0].filename).toMatch(/^media-\d{8}-\d{6}\.zip$/);

    const response = await app.request(body.parts[0].url);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toStartWith("attachment;");
    const entries = ZipEntries.read(new Uint8Array(await response.arrayBuffer()));

    expect([...entries.keys()].sort()).toEqual([
      "logo (1).svg",
      "logo.svg",
      "site/about.txt",
      "site/banners/hero (1).png",
      "site/banners/hero.png",
      "site/drafts/old/",
    ]);
    expect(text(entries.get("site/banners/hero.png"))).toBe("first");
    expect(text(entries.get("site/banners/hero (1).png"))).toBe("second");
    expect(text(entries.get("logo (1).svg"))).toBe("<svg></svg>");
  });

  test("one folder names the archive after itself", async () => {
    await service.media.save("a.txt", bytes("a"), "/press kit");
    const body = await prepared({ folders: ["/press kit"] });
    expect(body.parts[0].filename).toBe("press kit.zip");
  });

  test("parts close before 2 GiB, and a larger file is downloaded on its own", async () => {
    const first = await record("first.mp4", 1.2 * GiB);
    const second = await record("second.mp4", 1.2 * GiB);
    const huge = await record("huge.mp4", 2.5 * GiB);

    const body = await prepared({ ids: [first, second, huge] });
    expect(body.files).toBe(3);
    expect(body.bytes).toBe(4.9 * GiB);
    expect(body.parts.map((part) => [part.files, part.filename.replace(/^media-\d{8}-\d{6}/, "")])).toEqual([
      [1, "-1-of-2.zip"],
      [1, "-2-of-2.zip"],
    ]);
    expect(body.separate).toEqual([{ id: huge, filename: "huge.mp4", size: 2.5 * GiB, url: `/media/${huge}?download=true` }]);
  });

  test("past a ceiling nothing is prepared, and the refusal names the setting to raise", async () => {
    const refusal = async (ids: string[]) => {
      const response = await prepare({ ids });
      expect(response.status).toBe(413);
      const { error } = (await response.json()) as { error: { code: string; message: string } };
      expect(error.code).toBe("archive_too_large");
      return error.message;
    };

    const big = [await record("a.mp4", 3 * GiB), await record("b.mp4", 3 * GiB)];
    expect(await refusal(big)).toContain("download_max_size_mb");

    service.useMediaConfig({ ...service.mediaConfig, download_max_size_mb: 7 * 1024, download_max_files: 1 });
    expect(await refusal(big)).toContain("download_max_files");

    service.useMediaConfig({ ...service.mediaConfig, download_max_files: 2 });
    expect((await prepare({ ids: big })).status).toBe(201);
  });

  test("a file whose bytes vanished after preparing is skipped and named in missing-files.txt", async () => {
    const kept = await service.media.save("kept.txt", bytes("kept"));
    const lost = await service.media.save("lost.txt", bytes("lost"));
    const body = await prepared({ ids: [kept.id, lost.id] });
    await service.blobStorage.delete(lost.blob_key);

    const entries = await download(body.parts[0].url);
    expect([...entries.keys()]).toEqual(["kept.txt", "missing-files.txt"]);
    expect(text(entries.get("missing-files.txt"))).toContain("lost.txt");
  });

  test("preparing needs a key, and the part URL needs none but the ticket", async () => {
    const asset = await service.media.save("a.txt", bytes("a"));
    expect((await prepare({ ids: [asset.id] }, null)).status).toBe(401);

    const body = await prepared({ ids: [asset.id] });
    expect((await download(body.parts[0].url)).get("a.txt")).toEqual(bytes("a"));
    expect((await app.request("/api/media/archives/not-a-ticket/1")).status).toBe(404);
    expect((await app.request(body.parts[0].url.replace(/\/1$/, "/2"))).status).toBe(404);
  });

  test("the configured number of parts stream at once; one more is refused with Retry-After until one closes", async () => {
    service.useMediaConfig({ ...service.mediaConfig, download_max_streams: 2 });
    const asset = await service.media.save("a.txt", bytes("a"));
    const body = await prepared({ ids: [asset.id] });

    for (let index = 0; index < 3; index++) {
      expect((await app.request(body.parts[0].url, { method: "HEAD" })).status).toBe(200);
    }
    const open = await Promise.all([1, 2].map(() => app.request(body.parts[0].url)));
    expect(open.map((response) => response.status)).toEqual([200, 200]);

    const busy = await prepare({ ids: [asset.id] });
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("30");
    expect((await app.request(body.parts[0].url)).status).toBe(503);

    await open[0].body!.cancel();
    expect((await prepare({ ids: [asset.id] })).status).toBe(201);
    await Promise.all(open.slice(1).map((response) => response.body!.cancel()));
  });

  test("a cancelled download releases the blob it was reading", async () => {
    const asset = await service.media.save("a.txt", bytes("a"));
    const blobs = service.blobStorage;
    let released = 0;
    service.useBlobStorage(
      new Proxy(blobs, {
        get(target, property) {
          if (property !== "stream") {
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return async (key: string) => {
            const opened = await target.stream!(key);
            if (!opened) return null;
            const source = (opened.body instanceof Blob ? opened.body.stream() : opened.body).getReader();
            const body = new ReadableStream<Uint8Array>({
              async pull(controller) {
                const chunk = await source.read();
                if (chunk.done) controller.close();
                else controller.enqueue(chunk.value);
              },
              async cancel() {
                released++;
                await source.cancel();
              },
            });
            return { ...opened, body };
          };
        },
      })
    );

    const body = await prepared({ ids: [asset.id] });
    const response = await app.request(body.parts[0].url);
    await response.body!.cancel();
    expect(released).toBe(1);
  });

  test("an empty or unknown selection is refused", async () => {
    expect((await prepare({})).status).toBe(400);
    expect((await prepare({ folders: ["/"] })).status).toBe(400);
    expect((await prepare({ ids: ["01J0000000000000000000000"] })).status).toBe(404);
    expect((await prepare({ folders: ["/nowhere"] })).status).toBe(404);
  });
});
