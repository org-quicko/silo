import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../adapters/storage/sqlite/sqlite-store";
import { FsBlobStorage } from "../../adapters/blob/fs-blob-storage";
import { Service } from "../../core/service/service";
import { Scope } from "../../core/domain/scope";
import { SiloServer } from "../../http/server";

/**
 * `POST /api/projects/:project/environments/:env/copy` — the env→env move
 * (D22). Destination-driven: the route names the destination, the body names
 * the source.
 */
describe("Scope copy API", () => {
  let tempDir: string;
  let store: SqliteStore;
  let svc: Service;
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
    svc = new Service(store, { blobStore: new FsBlobStorage(path.join(tempDir, "media")) });
    rootKey = await svc.bootstrap();
    app = new SiloServer(svc, "test", false).build();

    await svc.createProject("acme");
    await svc.createEnvironment("acme", "prod");
    await svc.createEnvironment("acme", "staging");
    await svc.putSchema(prod, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
    });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("previews without writing, then copies the schema and entries", async () => {
    const source = await svc.createEntry(prod, "posts", { title: "from prod" });

    const preview = await copy(staging, { from: { project: "acme", env: "prod" }, dry_run: true });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ mode: "merge", dry_run: true, added: 1 });
    await expect(svc.getEntry(staging, "posts", source.id)).rejects.toThrow();

    const applied = await copy(staging, { from: { project: "acme", env: "prod" } });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({ mode: "merge", dry_run: false, added: 1 });

    expect((await svc.getEntry(staging, "posts", source.id)).data.title).toBe("from prod");
    expect((await svc.getCollection(staging, "posts")).schema).toMatchObject({ type: "object" });
    // The source is a copy source, not a move source.
    expect((await svc.getEntry(prod, "posts", source.id)).data.title).toBe("from prod");
  });

  test("re-copying an unchanged entry skips it instead of duplicating it", async () => {
    await svc.createEntry(prod, "posts", { title: "once" });
    await copy(staging, { from: { project: "acme", env: "prod" } });

    const again = await copy(staging, { from: { project: "acme", env: "prod" } });
    expect(await again.json()).toMatchObject({ added: 0, updated: 0, skipped: 1 });
    expect((await svc.listEntries(staging, "posts", {})).total).toBe(1);
  });

  test("prefer decides which side wins when both hold the entry", async () => {
    const source = await svc.createEntry(prod, "posts", { title: "source wins" });
    await svc.createEnvironment("acme", "staging");
    await svc.putSchema(staging, "posts", { type: "object" });
    await store.put({
      ...source,
      project: staging.project,
      env: staging.env,
      data: { title: "destination wins" },
    }, []);

    const local = await copy(staging, { from: { project: "acme", env: "prod" }, prefer: "local" });
    expect(await local.json()).toMatchObject({ skipped: 1, updated: 0 });
    expect((await svc.getEntry(staging, "posts", source.id)).data.title).toBe("destination wins");

    const remote = await copy(staging, { from: { project: "acme", env: "prod" }, prefer: "remote" });
    expect(await remote.json()).toMatchObject({ updated: 1 });
    expect((await svc.getEntry(staging, "posts", source.id)).data.title).toBe("source wins");
  });

  test("replace clears the destination's copy of the copied collections only", async () => {
    await svc.createEntry(prod, "posts", { title: "from prod" });
    await svc.putSchema(staging, "posts", { type: "object" });
    await svc.putSchema(staging, "notes", { type: "object" });
    const stale = await svc.createEntry(staging, "posts", { title: "stale" });
    const untouched = await svc.createEntry(staging, "notes", { title: "other collection" });

    const res = await copy(staging, { from: { project: "acme", env: "prod" }, mode: "replace" });
    expect(await res.json()).toMatchObject({ mode: "replace", added: 1, deleted: 1 });

    await expect(svc.getEntry(staging, "posts", stale.id)).rejects.toThrow();
    expect((await svc.getEntry(staging, "notes", untouched.id)).data.title).toBe("other collection");
  });

  test("copying a scope onto itself is a 400", async () => {
    const res = await copy(prod, { from: { project: "acme", env: "prod" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { message: 'source and destination are the same scope ("acme/prod")' },
    });
  });

  test("a missing or malformed source is a 400", async () => {
    expect((await copy(staging, {})).status).toBe(400);
    expect((await copy(staging, { from: { project: "acme", env: "_system" } })).status).toBe(400);
    expect((await copy(staging, { from: { project: "acme", env: "prod" }, mode: "sync" })).status).toBe(400);
  });

  test("a project-scoped key can copy between its own environments", async () => {
    await svc.createEntry(prod, "posts", { title: "from prod" });
    const { secret } = await svc.createKey("acme-only", [
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionSchemaRead),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesRead),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionCreate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionSchemaUpdate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesCreate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesUpdate),
    ]);

    // No transfer:* claim is held, and none is required (D22).
    const res = await copy(staging, { from: { project: "acme", env: "prod" } }, secret);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ added: 1 });
  });

  test("that key cannot reach a scope outside its project", async () => {
    await svc.createProject("other");
    await svc.createEnvironment("other", "prod");
    const { secret } = await svc.createKey("acme-only", [
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
    const { secret } = await svc.createKey("no-delete", [
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionSchemaRead),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesRead),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionCreate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionSchemaUpdate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesCreate),
      Claims.collection("acme", Claims.Root, Claims.Root, Claims.CollectionEntriesUpdate),
    ]);

    const res = await copy(staging, { from: { project: "acme", env: "prod" }, mode: "replace" }, secret);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
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
    await svc.createEntry(prod, "posts", { title: "from prod" });
    const res = await app.request("/api/projects/acme/envs/staging/copy", {
      method: "POST",
      headers: { Authorization: `Bearer ${rootKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: { project: "acme", env: "prod" } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ added: 1 });

    const anonymous = await app.request("/api/projects/acme/envs/staging/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: { project: "acme", env: "prod" } }),
    });
    expect(anonymous.status).toBe(401);
  });
});
