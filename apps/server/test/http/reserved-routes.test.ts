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
 * The two reserved API namespaces (D31/§13.1, D36).
 *
 * Reserving is only worth anything if it holds, and the failure it prevents is
 * silent: a path that falls through to the SPA handler answers 200 with
 * `index.html`, so a client deep-linking `/api/ext/anything` would get a page
 * instead of an error and a later release could not tell a genuine plugin route
 * from a client-router path someone had already relied on.
 */
describe("reserved API namespaces", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-reserved-routes-"));
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
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  /**
   * `/api/ext/` is where plugin-contributed routes will mount (D36).
   *
   * D31 reserved `/api/plugins/` for them and D34 took it back, because
   * management needs that space and the two cannot share it: once
   * `POST /api/plugins/acme/grant` is a management verb, a plugin route named
   * `grant` is unroutable. Reserving costs nothing now and is unavailable
   * later, so it happens in the change that defines the management API rather
   * than in the one that finally mounts a route.
   */
  test("/api/ext/* is reserved and answers 404, not the SPA", async () => {
    for (const url of [
      "http://local/api/ext/",
      "http://local/api/ext/acme",
      "http://local/api/ext/acme/webhook",
    ]) {
      const response = await app.fetch(new Request(url, { method: "POST" }));
      expect(response.status).toBe(404);
      const body: any = await response.json();
      expect(body.error.code).toBe("not_found");
    }
  });

  test("/api/plugins/* is still reserved", async () => {
    const response = await app.fetch(new Request("http://local/api/plugins/acme"));
    expect(response.status).toBe(404);
    expect((await response.json() as any).error.code).toBe("not_found");
  });

  /** The reservation must not shadow anything real: both live beside the
   *  scoped routes, and Hono matches in registration order. */
  test("reserving them did not capture an ordinary API route", async () => {
    const response = await app.fetch(new Request("http://local/api/health"));
    expect(response.status).toBe(200);
  });
});
