import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { ConfigLoader } from "../../src/config/config-loader";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import { ProviderRegistry } from "../../src/plugins";
import { MediaStorageSupervisor } from "../../src/settings";

/**
 * `GET`/`PUT /api/media/storage` (D45).
 *
 * Three things this proves that the supervisor's own tests cannot: the routes
 * are behind `media:configure` and nothing wider, `storage` is matched before
 * `/api/media/:id` would read it as an asset id, and a `media:*` key that
 * uploads and deletes all day cannot repoint the library.
 */
describe("media storage API (D45)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-storage-api-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
      // No `reload` and no `configPath`: this process was handed no file, which
      // is the case the read still has to answer.
      mediaStorage: new MediaStorageSupervisor({
        service,
        providers: ProviderRegistry.withBuiltins(),
        config: ConfigLoader.defaultConfig(),
        logger: Logger.silent(),
      }),
    }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const mint = async (claims: string[]) => (await service.keys.create("probe", claims)).secret;
  const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
  const json = (key: string) => ({ ...auth(key), "Content-Type": "application/json" });

  test("reading needs media:configure, which media:read is not", async () => {
    const uploader = await mint([Claims.MediaRead, Claims.MediaCreate, Claims.MediaDelete]);
    const refused = await app.request("/api/media/storage", { headers: auth(uploader) });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as any).error.message).toContain("media:configure");

    const configurer = await mint([Claims.MediaConfigure]);
    const allowed = await app.request("/api/media/storage", { headers: auth(configurer) });
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as any).in_force.driver).toBe("fs");
  });

  test("writing needs it too", async () => {
    const uploader = await mint([Claims.MediaRead, Claims.MediaCreate]);
    const refused = await app.request("/api/media/storage", {
      method: "PUT",
      headers: json(uploader),
      body: JSON.stringify({ driver: "fs" }),
    });
    expect(refused.status).toBe(403);
  });

  test("`storage` is not read as an asset id", async () => {
    // Both routes live under /api/media/. Registration order is what keeps
    // "storage" from being captured by /api/media/:id, so a 404 here would mean
    // the ordering broke rather than that the asset is missing.
    const response = await app.request("/api/media/storage", { headers: auth(rootKey) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ writable: false });
  });

  test("a process with no config file says so rather than guessing at a path", async () => {
    const response = await app.request("/api/media/storage", {
      method: "PUT",
      headers: json(rootKey),
      body: JSON.stringify({ driver: "fs", path: "/srv/media" }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.message).toContain("not started from a config file");
  });

  test("a malformed body is a 400, not a 500", async () => {
    const response = await app.request("/api/media/storage", {
      method: "PUT",
      headers: json(rootKey),
      body: JSON.stringify({ bucket: "no-driver" }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.message).toContain("driver");
  });

  test("the read never carries the secret", async () => {
    const secretService = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    const withSecret = new SiloServer(secretService, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
      mediaStorage: new MediaStorageSupervisor({
        service: secretService,
        providers: ProviderRegistry.withBuiltins(),
        config: {
          ...ConfigLoader.defaultConfig(),
          blob_storage: { driver: "s3", bucket: "b", secretAccessKey: "shhh" },
        },
        logger: Logger.silent(),
      }),
    }).build();

    const response = await withSecret.request("/api/media/storage", { headers: auth(rootKey) });
    const body = await response.text();
    expect(body).not.toContain("shhh");
    expect(JSON.parse(body).in_force.secret_access_key_set).toBe(true);
  });
});
