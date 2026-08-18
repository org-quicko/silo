import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../adapters/storage/sqlite/sqlite-store";
import { Service } from "../../core/service/service";
import { EntryUtils } from "../../core/domain/entry-utils";
import { Scope } from "../../core/domain/scope";
import { SiloServer } from "../../http/server";

// Transfer is instance-wide: one archive spans every project and env, so the
// `transfer:*` claims are not sufficient on their own — the caller has to hold
// the collection permissions the operation exercises at `*` / `*` / `*` too.
const instanceWideRead = [
  Claims.collection("*", "*", "*", Claims.CollectionSchemaRead),
  Claims.collection("*", "*", "*", Claims.CollectionEntriesRead),
];
const instanceWideWrite = [
  Claims.collection("*", "*", "*", Claims.CollectionEntriesCreate),
  Claims.collection("*", "*", "*", Claims.CollectionEntriesUpdate),
  Claims.collection("*", "*", "*", Claims.CollectionEntriesDelete),
];

describe("claims API authorization", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: Service;
  let app: Hono;
  let rootKey: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-claims-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new Service(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.bootstrap();
    await service.putSchema(Scope.Default, "posts", { type: "object", "x-silo-auth": true });
    app = new SiloServer(service, "test", false).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("entry CRUD actions are enforced independently", async () => {
    const claims = [
      Claims.collection("default", "prod", "posts", Claims.CollectionSchemaRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesCreate),
    ];
    const { secret } = await service.createKey("frontend", claims);
    const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };

    expect((await app.request("/api/session", { headers })).status).toBe(200);
    expect((await app.request("/api/projects/default/environments/prod/collections", { headers })).status).toBe(200);
    const created = await app.request("/api/projects/default/environments/prod/collections/posts", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "hello" }),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as any;
    expect((await app.request("/api/projects/default/environments/prod/collections/posts", { headers })).status).toBe(200);
    expect((await app.request(`/api/projects/default/environments/prod/collections/posts/${entry.id}?rev=1`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ title: "changed" }),
    })).status).toBe(403);
    expect((await app.request(`/api/projects/default/environments/prod/collections/posts/${entry.id}?rev=1`, {
      method: "DELETE",
      headers,
    })).status).toBe(403);
  });

  test("key creation enforces non-escalating delegation", async () => {
    const { secret } = await service.createKey("delegator", [
      Claims.KeysCreate,
      Claims.collection("default", "default", "posts", Claims.CollectionEntriesRead),
    ]);
    const create = (claims: string[]) =>
      app.request("/api/keys", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ label: "child", claims }),
      });

    expect((await create([Claims.collection("default", "default", "posts", Claims.CollectionEntriesRead)])).status).toBe(201);
    expect((await create([Claims.collection("default", "default", "posts", Claims.CollectionEntriesUpdate)])).status).toBe(403);
    expect((await create([Claims.Root])).status).toBe(403);
    // A claim rejected inside @silo/shared must still reach the wire as a 400
    // validation_failed body — if the handler ever stopped recognizing the
    // shared ValidationError this would silently become a 500 internal error.
    const invalid = await create(["keys:*"]);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: {
        code: "validation_failed",
        message: 'unknown or invalid claim "keys:*"',
        details: [],
      },
    });
  });

  test("invalid obsolete key records do not blank the claims key list", async () => {
    const now = EntryUtils.now();
    await store.put({
      id: EntryUtils.newID(),
      project: Scope.System.project,
      env: Scope.System.env,
      collection: "_keys",
      rev: 1,
      seq: 0,
      created_at: now,
      updated_at: now,
      data: { label: "obsolete", role: "admin", hash: "unused", prefix: "silo_old…" },
    });

    const response = await app.request("/api/keys", {
      headers: { Authorization: `Bearer ${rootKey}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ label: string; claims: string[] }> };
    expect(body.items.some((key) => key.label === "root" && key.claims.includes("*"))).toBe(true);
    expect(body.items.some((key) => key.label === "obsolete")).toBe(false);
  });

  test("bootstrap replaces an obsolete-only key set with a claims root", async () => {
    for (const key of await service.listKeys()) await service.revokeKey(key.id);
    const now = EntryUtils.now();
    await store.put({
      id: EntryUtils.newID(),
      project: Scope.System.project,
      env: Scope.System.env,
      collection: "_keys",
      rev: 1,
      seq: 0,
      created_at: now,
      updated_at: now,
      data: { label: "obsolete", role: "admin", hash: "unused", prefix: "silo_old…" },
    });

    const secret = await service.bootstrap();
    expect(secret.startsWith("silo_")).toBe(true);
    expect((await service.authenticate(secret)).claims).toEqual([Claims.Root]);
  });

  test("changing public access needs its dedicated claim", async () => {
    const { secret } = await service.createKey("schema editor", [
      Claims.collection("default", "prod", "posts", Claims.CollectionSchemaUpdate),
    ]);
    const response = await app.request("/api/projects/default/environments/prod/collections/posts/schema", {
      method: "PUT",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "object", "x-silo-auth": false }),
    });
    expect(response.status).toBe(403);
  });

  test("key-bearing exports need the additional key claim", async () => {
    const { secret } = await service.createKey("exporter", [
      Claims.TransferExport,
      ...instanceWideRead,
    ]);
    const headers = { Authorization: `Bearer ${secret}` };
    expect((await app.request("/api/export", { headers })).status).toBe(200);
    expect((await app.request("/api/export?with_keys=true", { headers })).status).toBe(403);
  });

  test("key-bearing imports need the additional key claim", async () => {
    const archivePath = path.join(tempDir, "keys.tar.gz");
    await service.exportTarGz(archivePath, { withKeys: true });
    const archive = await fs.readFile(archivePath);
    const { secret: dataOnly } = await service.createKey("data importer", [
      Claims.TransferImport,
      ...instanceWideWrite,
    ]);
    const { secret: withKeys } = await service.createKey("key importer", [
      Claims.TransferImport,
      Claims.KeysImport,
      ...instanceWideWrite,
    ]);
    const request = (secret: string) =>
      app.request("/api/import?dry_run=true", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/gzip" },
        body: archive,
      });

    expect((await request(dataOnly)).status).toBe(403);
    expect((await request(withKeys)).status).toBe(200);
  });

  test("a scoped key hides other public collections within scope", async () => {
    await service.putSchema(Scope.Default, "public_posts", { type: "object" });
    await service.putSchema(Scope.Default, "public_pages", { type: "object" });
    await service.createEntry(Scope.Default, "public_posts", { title: "public" });
    const { secret } = await service.createKey("posts reader", [
      Claims.collection("default", "prod", "public_posts", Claims.CollectionSchemaRead),
      Claims.collection("default", "prod", "public_posts", Claims.CollectionEntriesRead),
    ]);
    const headers = { Authorization: `Bearer ${secret}` };

    const listed = await app.request("/api/projects/default/environments/prod/collections", { headers });
    const body = (await listed.json()) as { items: Array<{ name: string }> };
    expect(body.items.map((collection) => collection.name)).toEqual(["public_posts"]);
    expect((await app.request("/api/projects/default/environments/prod/collections/public_posts", { headers })).status).toBe(200);
    expect((await app.request("/api/projects/default/environments/prod/collections/public_pages", { headers })).status).toBe(403);
    expect((await app.request("/api/projects/default/environments/prod/collections/public_pages")).status).toBe(200);
  });

  test("cross-project and cross-env isolation is enforced by claims", async () => {
    const scopeAcmeProd = Scope.of("acme", "prod");
    const scopeAcmeDev = Scope.of("acme", "dev");
    const scopeOtherProd = Scope.of("other", "prod");

    await service.putSchema(scopeAcmeProd, "articles", { type: "object", "x-silo-auth": true });
    await service.putSchema(scopeAcmeDev, "articles", { type: "object", "x-silo-auth": true });
    await service.putSchema(scopeOtherProd, "articles", { type: "object", "x-silo-auth": true });

    await service.createEntry(scopeAcmeProd, "articles", { title: "Acme Prod" });
    await service.createEntry(scopeAcmeDev, "articles", { title: "Acme Dev" });
    await service.createEntry(scopeOtherProd, "articles", { title: "Other Prod" });

    // Key with acme/prod/*
    const { secret: keyProd } = await service.createKey("acme prod key", [
      Claims.collection("acme", "prod", "*", Claims.CollectionEntriesRead),
    ]);
    const headersProd = { Authorization: `Bearer ${keyProd}` };

    expect((await app.request("/api/projects/acme/envs/prod/collections/articles", { headers: headersProd })).status).toBe(200);
    expect((await app.request("/api/projects/acme/envs/dev/collections/articles", { headers: headersProd })).status).toBe(403);
    expect((await app.request("/api/projects/other/envs/prod/collections/articles", { headers: headersProd })).status).toBe(403);

    // Key with acme/*/* (all envs in acme)
    const { secret: keyAcmeAll } = await service.createKey("acme all key", [
      Claims.collection("acme", "*", "*", Claims.CollectionEntriesRead),
    ]);
    const headersAcmeAll = { Authorization: `Bearer ${keyAcmeAll}` };

    expect((await app.request("/api/projects/acme/envs/prod/collections/articles", { headers: headersAcmeAll })).status).toBe(200);
    expect((await app.request("/api/projects/acme/envs/dev/collections/articles", { headers: headersAcmeAll })).status).toBe(200);
    expect((await app.request("/api/projects/other/envs/prod/collections/articles", { headers: headersAcmeAll })).status).toBe(403);
  });

  test("transfer claims cannot lift a project-scoped key out of its project", async () => {
    // An archive spans every project and env, so `transfer:*` on its own was
    // a way straight out of a scoped key's scope — read every other tenant's
    // content on export, overwrite it on import.
    const { secret: scopedExport } = await service.createKey("acme exporter", [
      Claims.TransferExport,
      Claims.collection("acme", "*", "*", Claims.CollectionSchemaRead),
      Claims.collection("acme", "*", "*", Claims.CollectionEntriesRead),
    ]);
    const exportRes = await app.request("/api/export", {
      headers: { Authorization: `Bearer ${scopedExport}` },
    });
    expect(exportRes.status).toBe(403);
    expect((await exportRes.json()) as any).toMatchObject({
      error: { message: expect.stringContaining("instance-wide") },
    });

    const { secret: scopedImport } = await service.createKey("acme importer", [
      Claims.TransferImport,
      Claims.collection("acme", "*", "*", Claims.CollectionEntriesCreate),
      Claims.collection("acme", "*", "*", Claims.CollectionEntriesUpdate),
      Claims.collection("acme", "*", "*", Claims.CollectionEntriesDelete),
    ]);
    // Authorization is settled before the body is read, so an empty one is
    // enough to reach the check under test.
    expect(
      (await app.request("/api/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${scopedImport}`, "Content-Type": "application/gzip" },
        body: new Uint8Array(),
      })).status,
    ).toBe(403);

    // Widening the same claims to every scope is what the operation actually
    // needs, and it is then allowed.
    const { secret: wide } = await service.createKey("instance exporter", [
      Claims.TransferExport,
      ...instanceWideRead,
    ]);
    expect(
      (await app.request("/api/export", { headers: { Authorization: `Bearer ${wide}` } })).status,
    ).toBe(200);
  });
});
