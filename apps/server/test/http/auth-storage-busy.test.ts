import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { StorageBusyError } from "../../src/core/errors/storage-busy-error";
import { SiloService } from "../../src/core/services/silo-service";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * A key is looked up in storage on every request. When storage cannot answer
 * — a Postgres failover, a full scan queue — that says nothing about the key,
 * so the answer is a retryable 503 and never a 401 telling the client to drop
 * a valid key.
 */
describe("authentication while storage is busy", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-auth-busy-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("a key storage could not look up is a 503 with Retry-After", async () => {
    service.keys.authenticate = () => Promise.reject(new StorageBusyError("storage cannot be reached; retry shortly"));
    const response = await app.request("/api/projects", { headers: { Authorization: `Bearer ${rootKey}` } });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("busy");
  });

  test("a key that matches nothing is still a 401", async () => {
    const response = await app.request("/api/projects", {
      headers: { Authorization: `Bearer ${rootKey.slice(0, -4)}AAAA` },
    });
    expect(response.status).toBe(401);
  });
});
