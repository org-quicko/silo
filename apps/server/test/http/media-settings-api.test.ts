import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { ConfigLoader } from "../../src/config/config-loader";
import { MediaTable } from "../../src/config/media-table";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import { MediaPolicySupervisor } from "../../src/settings";

/**
 * `GET`/`PUT /api/media/settings` (D46).
 *
 * What the supervisor's own unit tests cannot show: the routes are behind
 * `media:configure` and nothing wider, `settings` is matched before
 * `/api/media/:id` would read it as an asset id, and a saved allowlist takes
 * effect on the very next upload rather than at the next restart.
 */
describe("media settings API (D46)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;
  let configPath: string;

  const build = async (options: { withFile: boolean }) => {
    const config = ConfigLoader.defaultConfig();
    config.media = { base_url_target: "server", extensions: ["png"] };
    service.useMediaConfig(config.media);

    return new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
      mediaPolicy: new MediaPolicySupervisor({
        service,
        config,
        logger: Logger.silent(),
        ...(options.withFile
          ? { configPath, reload: () => ConfigLoader.loadConfig(configPath, true) }
          : {}),
      }),
    }).build();
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-settings-api-"));
    configPath = path.join(tempDir, "silo.toml");
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    app = await build({ withFile: false });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const mint = async (claims: string[]) => (await service.keys.create("probe", claims)).secret;
  const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
  const json = (key: string) => ({ ...auth(key), "Content-Type": "application/json" });

  const upload = async (key: string, filename: string) => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], filename, { type: "image/png" }));
    return app.request("/api/media", { method: "POST", headers: auth(key), body: form });
  };

  test("reading needs media:configure, which media:read is not", async () => {
    const uploader = await mint([Claims.MediaRead, Claims.MediaCreate]);
    const refused = await app.request("/api/media/settings", { headers: auth(uploader) });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as any).error.message).toContain("media:configure");

    const configurer = await mint([Claims.MediaConfigure]);
    const allowed = await app.request("/api/media/settings", { headers: auth(configurer) });
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as any).in_force.extensions).toEqual(["png"]);
  });

  test("`settings` is not read as an asset id", async () => {
    const response = await app.request("/api/media/settings", { headers: auth(rootKey) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ writable: false });
  });

  test("a process with no config file says so rather than guessing at a path", async () => {
    const response = await app.request("/api/media/settings", {
      method: "PUT",
      headers: json(rootKey),
      body: JSON.stringify({ extensions: ["png", "jpg"] }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.message).toContain("not started from a config file");
  });

  test("a relative base URL is a 400, not a link that quietly goes nowhere", async () => {
    const response = await app.request("/api/media/settings", {
      method: "PUT",
      headers: json(rootKey),
      body: JSON.stringify({ base_url: "/uploads" }),
    });
    expect(response.status).toBe(400);
  });

  test("the allowlist gates uploads, and a save applies to the next one", async () => {
    app = await build({ withFile: true });

    const refused = await upload(rootKey, "notes.pdf");
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as any).error.message).toContain("not accepted");

    const saved = await app.request("/api/media/settings", {
      method: "PUT",
      headers: json(rootKey),
      body: JSON.stringify({ extensions: ["png", "pdf"] }),
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as any).in_force.extensions).toEqual(["png", "pdf"]);

    // No restart between these two: the policy is read at the moment an upload
    // acts, the way the blob store is (D45).
    const accepted = await upload(rootKey, "notes.pdf");
    expect(accepted.status).toBe(201);

    expect((await MediaTable.read(configPath))?.extensions).toEqual(["png", "pdf"]);
  });

  test("a saved base URL is what the media API then hands out", async () => {
    app = await build({ withFile: true });
    const created = await upload(rootKey, "hero.png");
    const id = ((await created.json()) as any).id;

    await app.request("/api/media/settings", {
      method: "PUT",
      headers: json(rootKey),
      body: JSON.stringify({ base_url: "https://cms.example.com" }),
    });

    const asset = await app.request(`/api/media/${id}`, { headers: auth(rootKey) });
    expect(((await asset.json()) as any).url).toBe(`https://cms.example.com/media/${id}`);
  });

  test("in store mode the URL addresses the blob key, which is what a bucket serves", async () => {
    app = await build({ withFile: true });
    const created = await upload(rootKey, "hero.png");
    const body = (await created.json()) as any;

    await app.request("/api/media/settings", {
      method: "PUT",
      headers: json(rootKey),
      body: JSON.stringify({ base_url: "https://cdn.example.com", base_url_target: "store" }),
    });

    const asset = await app.request(`/api/media/${body.id}`, { headers: auth(rootKey) });
    expect(((await asset.json()) as any).url).toBe(`https://cdn.example.com/${body.blob_key}`);
  });
});
