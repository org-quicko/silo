import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import { Observability } from "../../src/observability";

describe("the observability API", () => {
  let directory: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "silo-observability-api-"));
    store = await SqliteStore.open(path.join(directory, "silo.db"));
    service = new SiloService(store);
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
      observability: new Observability({
        dataDirectory: directory,
        storageDriver: "sqlite",
        blobDriver: "fs",
      }),
    }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const auth = (secret: string) => ({ Authorization: `Bearer ${secret}` });

  test("requires its own read-only claim", async () => {
    const { secret } = await service.keys.create("media reader", [Claims.MediaRead]);
    const response = await app.request("/api/observability", { headers: auth(secret) });
    expect(response.status).toBe(403);
    expect(((await response.json()) as any).error.message).toContain("observability:read");
  });

  test("returns normalized request, process, and storage metrics", async () => {
    const { secret } = await service.keys.create("operator", [Claims.ObservabilityRead]);
    await app.request("/api/health", { headers: auth(secret) });
    await app.request("/api/not-a-real-route", { headers: auth(secret) });

    const response = await app.request("/api/observability", { headers: auth(secret) });
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as any;
    expect(snapshot.requests.total).toBe(2);
    expect(snapshot.requests.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "GET", route: "/api/health", hits: 1 }),
      expect.objectContaining({ method: "GET", route: "/api/*", hits: 1, errors: 1 }),
    ]));
    expect(JSON.stringify(snapshot)).not.toContain("not-a-real-route");
    expect(snapshot.process.rss_bytes).toBeGreaterThan(0);
    expect(["sampling", "ready"]).toContain(snapshot.storage.state);
  });
});
