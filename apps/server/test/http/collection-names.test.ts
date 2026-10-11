import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import type { CollectionPermission } from "@silo/shared/collection-permission";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * A collection name may have 128 characters (D104), and a name past that, or
 * one that breaks the grammar, is a 400 that says why, for every key. It was a
 * 403 "missing claim" for any key but root, because the claim was checked
 * first and no claim can spell a name the grammar refuses.
 */
describe("collection names over HTTP", () => {
  const base = "/api/projects/default/envs/prod/collections";
  const longest = `a${"b".repeat(127)}`;
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let editor: string;

  const send = (method: string, url: string, body: unknown) =>
    app.request(url, {
      method,
      headers: { Authorization: `Bearer ${editor}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-collection-names-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.keys.bootstrap();
    // Every collection permission, which is what a rename asks for on both names; never root.
    const permissions = new Set<CollectionPermission>([Claims.CollectionCreate, ...Claims.RenamePermissions]);
    editor = (await service.keys.create("editor", [...permissions].map((permission) => Claims.collection("*", "*", "*", permission)))).secret;
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("a 128-character name is created, by a key that is not root", async () => {
    const response = await send("POST", base, { name: longest, schema: { type: "object" } });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { name: string }).name).toBe(longest);
  });

  test("a longer name is a 400 that gives the length, not a 403", async () => {
    const response = await send("POST", base, { name: `${longest}c`, schema: { type: "object" } });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe("invalid collection name: the name has 129 characters, and the most is 128");
  });

  test("a name that breaks the grammar says which rule", async () => {
    const response = await send("POST", base, { name: "2024_posts", schema: { type: "object" } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/must start with a lowercase letter/);
  });

  test("a rename's preview refuses a name the rename would refuse", async () => {
    expect((await send("POST", base, { name: "posts", schema: { type: "object" } })).status).toBe(201);
    const preview = await send("PATCH", `${base}/posts?dry_run=true`, { name: `${longest}c` });
    expect(preview.status).toBe(400);
    const renamed = await send("PATCH", `${base}/posts`, { name: longest });
    expect(renamed.status).toBe(200);
  });

  test("the claim grammar spells the longest name, so a scoped key can hold it", () => {
    expect(Claims.isValid(`collections:default/prod/${longest}:entries:read`)).toBe(true);
  });
});
