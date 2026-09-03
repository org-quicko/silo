import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { FsBlobStorage } from "../../src/adapters/blob/fs-blob-storage";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * `POST /api/projects/:project/environments/:env/copy` — the env→env move
 * (D22). Destination-driven: the route names the destination, the body names
 * the source.
 */
describe("Scope copy API", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  const prod = Scope.of("acme", "prod");
  const staging = Scope.of("acme", "staging");

  const copy = (to: Scope, body: unknown, key = rootKey) =>
    app.request(`/api/projects/${to.project}/environments/${to.env}/copy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-scope-copy-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { blobStorage: new FsBlobStorage(path.join(tempDir, "media")) });
    rootKey = await service.keys.bootstrap();
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();

    await service.scopes.createProject("acme");
    await service.scopes.createEnvironment("acme", "prod");
    await service.scopes.createEnvironment("acme", "staging");
    await service.collections.putSchema(prod, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
    });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("previews without writing, then copies the schema and entries", async () => {
    const source = await service.entries.create(prod, "posts", { title: "from prod" });

    const preview = await copy(staging, { from: { project: "acme", env: "prod" }, dry_run: true });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ mode: "merge", dry_run: true, added: 1 });
    await expect(service.entries.get(staging, "posts", source.id)).rejects.toThrow();

    const applied = await copy(staging, { from: { project: "acme", env: "prod" } });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({ mode: "merge", dry_run: false, added: 1 });

    expect((await service.entries.get(staging, "posts", source.id)).data.title).toBe("from prod");
    expect((await service.collections.get(staging, "posts")).schema).toMatchObject({ type: "object" });
    // The source is a copy source, not a move source.
    expect((await service.entries.get(prod, "posts", source.id)).data.title).toBe("from prod");
  });

  test("re-copying an unchanged entry skips it instead of duplicating it", async () => {
    await service.entries.create(prod, "posts", { title: "once" });
    await copy(staging, { from: { project: "acme", env: "prod" } });

    const again = await copy(staging, { from: { project: "acme", env: "prod" } });
    expect(await again.json()).toMatchObject({ added: 0, updated: 0, skipped: 1 });
    expect((await service.entries.list(staging, "posts", {})).total).toBe(1);
  });

  test("prefer decides which side wins when both hold the entry", async () => {
    const source = await service.entries.create(prod, "posts", { title: "source wins" });
    await service.scopes.createEnvironment("acme", "staging");
    await service.collections.putSchema(staging, "posts", { type: "object" });
    await store.put({
      ...source,
      project: staging.project,
      env: staging.env,
      data: { title: "destination wins" },
    }, { usages: [], search: null });

    const local = await copy(staging, { from: { project: "acme", env: "prod" }, prefer: "local" });
    expect(await local.json()).toMatchObject({ skipped: 1, updated: 0 });
    expect((await service.entries.get(staging, "posts", source.id)).data.title).toBe("destination wins");

    const remote = await copy(staging, { from: { project: "acme", env: "prod" }, prefer: "remote" });
    expect(await remote.json()).toMatchObject({ updated: 1 });
    expect((await service.entries.get(staging, "posts", source.id)).data.title).toBe("source wins");
  });

  test("replace clears the destination's copy of the copied collections only", async () => {
    await service.entries.create(prod, "posts", { title: "from prod" });
    await service.collections.putSchema(staging, "posts", { type: "object" });
    await service.collections.putSchema(staging, "notes", { type: "object" });
    const stale = await service.entries.create(staging, "posts", { title: "stale" });
    const untouched = await service.entries.create(staging, "notes", { title: "other collection" });

    const response = await copy(staging, { from: { project: "acme", env: "prod" }, mode: "replace" });
    expect(await response.json()).toMatchObject({ mode: "replace", added: 1, deleted: 1 });

    await expect(service.entries.get(staging, "posts", stale.id)).rejects.toThrow();
    expect((await service.entries.get(staging, "notes", untouched.id)).data.title).toBe("other collection");
  });

  test("copying a scope onto itself is a 400", async () => {
    const response = await copy(prod, { from: { project: "acme", env: "prod" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: 'source and destination are the same scope ("acme/prod")' },
    });
  });

  test("a missing or malformed source is a 400", async () => {
    expect((await copy(staging, {})).status).toBe(400);
    expect((await copy(staging, { from: { project: "acme", env: "_system" } })).status).toBe(400);
    expect((await copy(staging, { from: { project: "acme", env: "prod" }, mode: "sync" })).status).toBe(400);
  });

  test("a project-scoped key can copy between its own environments", async () => {
    await service.entries.create(prod, "posts", { title: "from prod" });
    const { secret } = await service.keys.create("acme-only", [
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionSchemaRead),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesRead),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionCreate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionSchemaUpdate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesCreate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesUpdate),
    ]);

    // No transfer:* claim is held, and none is required (D22).
    const response = await copy(staging, { from: { project: "acme", env: "prod" } }, secret);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ added: 1 });
  });

  test("that key cannot reach a scope outside its project", async () => {
    await service.scopes.createProject("other");
    await service.scopes.createEnvironment("other", "prod");
    const { secret } = await service.keys.create("acme-only", [
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionSchemaRead),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesRead),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionCreate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionSchemaUpdate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesCreate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesUpdate),
    ]);

    const outboundSource = await copy(staging, { from: { project: "other", env: "prod" } }, secret);
    expect(outboundSource.status).toBe(403);

    const outboundDestination = await copy(
      Scope.of("other", "prod"),
      { from: { project: "acme", env: "prod" } },
      secret,
    );
    expect(outboundDestination.status).toBe(403);
  });

  test("replace mode additionally requires delete authority", async () => {
    const { secret } = await service.keys.create("no-delete", [
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionSchemaRead),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesRead),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionCreate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionSchemaUpdate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesCreate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesUpdate),
    ]);

    const response = await copy(staging, { from: { project: "acme", env: "prod" }, mode: "replace" }, secret);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain(Claims.CollectionDelete);

    // Merge, which deletes nothing, is still allowed for the same key.
    expect((await copy(staging, { from: { project: "acme", env: "prod" } }, secret)).status).toBe(200);
  });

  test("`_keys` is never carried between scopes", async () => {
    await copy(staging, { from: { project: "acme", env: "prod" } });
    const scopes = await store.listScopes();
    expect(scopes.some((s) => s.isSystem())).toBe(false);
    expect(await store.listEntryCollections(staging)).not.toContain("_keys");
  });

  test("the short `/envs` spelling is authorized identically", async () => {
    await service.entries.create(prod, "posts", { title: "from prod" });
    const response = await app.request("/api/projects/acme/envs/staging/copy", {
      method: "POST",
      headers: { Authorization: `Bearer ${rootKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: { project: "acme", env: "prod" } }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ added: 1 });

    const anonymous = await app.request("/api/projects/acme/envs/staging/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: { project: "acme", env: "prod" } }),
    });
    expect(anonymous.status).toBe(401);
  });
});
