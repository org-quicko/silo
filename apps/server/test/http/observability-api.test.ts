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
import { ConfigLoader } from "../../src/config/config-loader";
import { Scope } from "../../src/core/domain/scope";

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
    const { secret } = await service.keys.create("media reader", [Claims.MediaCreate]);
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
    // An unmatched path is the catch-all: whatever was typed never reaches the snapshot.
    expect(JSON.stringify(snapshot)).not.toContain("not-a-real-route");
    expect(snapshot.process.rss_bytes).toBeGreaterThan(0);
    expect(["sampling", "ready"]).toContain(snapshot.storage.state);
  });

  /**
   * D99: endpoints carry the names of the scopes a request reached, never an id,
   * and each caller sees only the names its own collection claims reach.
   */
  test("names the scope of a successful request only for callers that reach it", async () => {
    const now = new Date(Date.UTC(2026, 0, 1));
    await store.putSchema(Scope.Default, "posts", { type: "object" });
    await store.put(
      { id: "01JENTRY0000000000000000AB", project: "default", env: "prod", collection: "posts", rev: 1, seq: 0, created_at: now, updated_at: now, data: { title: "hi" } },
      { usages: [], search: null }
    );
    const { secret: root } = await service.keys.create("root", [Claims.Root]);
    await app.request("/api/projects/default/environments/prod/collections/posts/01JENTRY0000000000000000AB", { headers: auth(root) });
    await app.request("/api/projects/made-up/environments/prod/collections/posts/01JENTRY0000000000000000AB", { headers: auth(root) });

    const read = async (claims: string[]) => {
      const { secret } = await service.keys.create("reader", [Claims.ObservabilityRead, ...claims]);
      const response = await app.request("/api/observability", { headers: auth(secret) });
      return JSON.stringify(((await response.json()) as any).requests.endpoints);
    };

    const pattern = "/api/projects/:project/environments/:env/collections/:name/:id";
    const named = "/api/projects/default/environments/prod/collections/posts/:id";

    const reaching = await read([Claims.collection("default", "*", "*", Claims.CollectionSchemaRead)]);
    expect(reaching).toContain(named);
    // The failed request, with its made-up project, is on the pattern.
    expect(reaching).toContain(pattern);

    const elsewhere = await read([Claims.collection("other", "*", "*", Claims.CollectionSchemaRead)]);
    expect(elsewhere).not.toContain(named);
    expect(elsewhere).toContain(pattern);

    for (const body of [reaching, elsewhere]) {
      expect(body).not.toContain("01JENTRY0000000000000000AB");
      expect(body).not.toContain("made-up");
    }
  });
});

describe("the request log", () => {
  test("names the key that made each request, and never its secret", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "silo-request-log-"));
    const store = await SqliteStore.open(path.join(directory, "silo.db"));
    try {
      const service = new SiloService(store);
      const file = path.join(directory, "silo.log");
      const logger = Logger.create({ ...ConfigLoader.defaultConfig().log, file, format: "json", requests: true });
      const app = new SiloServer(service, { version: "test", authDisabled: false, logger }).build();

      const { entry, secret } = await service.keys.create("ci-deploy", [Claims.ObservabilityRead]);
      // `/api/health` skips authentication, so an authenticated route and an anonymous one.
      await app.request("/api/observability", { headers: { Authorization: `Bearer ${secret}` } });
      await app.request("/api/projects");
      await logger.close();

      const lines = (await fs.readFile(file, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((line) => line.msg === "request" || line.message === "request");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ path: "/api/observability", key: "ci-deploy", key_id: entry.id });
      expect(lines[1].key).toBeUndefined();
      expect(await fs.readFile(file, "utf8")).not.toContain(secret);
    } finally {
      await store.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
