import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * `/media/*` is readable from any origin, and only readable (D101). The admin's
 * text preview `fetch`es an asset from the connected server, which is another
 * origin whenever the admin is not served by that server.
 */
describe("media streaming is readable across origins", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-cors-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    app = new SiloServer(service, {
      version: "test",
      authDisabled: true,
      logger: Logger.silent(),
    }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const origin = "http://localhost:5173";

  test("a GET from another origin may read the bytes, with no credentials", async () => {
    const asset = await service.media.save("hero.png", new Uint8Array([1, 2, 3]));
    const response = await app.request(`/media/${asset.id}`, { headers: { origin } });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("a ranged read carries it too", async () => {
    const asset = await service.media.save("hero.png", new Uint8Array([1, 2, 3]));
    const response = await app.request(`/media/${asset.id}`, {
      headers: { origin, range: "bytes=0-1" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("a preflight allows GET and HEAD and nothing else", async () => {
    const asset = await service.media.save("hero.png", new Uint8Array([1, 2, 3]));
    const preflight = await app.request(`/media/${asset.id}`, {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "GET" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET,HEAD");
  });
});
