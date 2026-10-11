import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import type { MediaStats } from "../../src/core/media/media-stats";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

describe("GET /api/media/stats (D106)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-stats-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const stats = async () => {
    const response = await app.request("/api/media/stats");
    expect(response.status).toBe(200);
    return (await response.json()) as MediaStats;
  };

  test("an empty library answers zeros and no largest file", async () => {
    expect(await stats()).toEqual({
      files: 0,
      bytes: 0,
      folders: 0,
      types: [],
      largest: null,
      last_upload: null,
      deleting: 0,
    });
  });

  test("totals files, bytes and folders, splits by kind, and needs no key", async () => {
    await service.media.save("hero.png", new Uint8Array(300), "/site/banners");
    await service.media.save("icon.png", new Uint8Array(100), "/site");
    const clip = await service.media.save("clip.mp4", new Uint8Array(1000), "/video");
    await service.media.save("terms.pdf", new Uint8Array(50));
    await service.media.save("data.bin", new Uint8Array(10));
    await service.media.createFolder("/empty/nested");

    const body = await stats();
    expect(body.files).toBe(5);
    expect(body.bytes).toBe(1460);
    expect(body.folders).toBe(5);
    expect(body.types).toEqual([
      { type: "video", files: 1, bytes: 1000 },
      { type: "image", files: 2, bytes: 400 },
      { type: "document", files: 1, bytes: 50 },
      { type: "other", files: 1, bytes: 10 },
    ]);
    expect(body.largest).toEqual({ id: clip.id, filename: "clip.mp4", folder: "/video", size: 1000 });
    expect(body.last_upload).not.toBeNull();
    expect(body.deleting).toBe(0);
  });
});
