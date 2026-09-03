import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

// Transfer is instance-wide: one archive spans every project and env, so the
// `transfer:*` claims are not sufficient on their own — the caller has to hold
// the collection permissions the operation exercises at `*` / `*` / `*` too.
const instanceWideRead = [
  Claims.collection("*", "*", "*", Claims.CollectionSchemaRead),
  Claims.collection("*", "*", "*", Claims.CollectionEntriesRead),
];
// Spelled out literally rather than derived from `Claims.TransferWritePermissions`,
// so that narrowing the constant fails a test instead of quietly narrowing
// these fixtures with it.
const instanceWideWrite = [
  Claims.collection("*", "*", "*", Claims.CollectionCreate),
  Claims.collection("*", "*", "*", Claims.CollectionSchemaUpdate),
  Claims.collection("*", "*", "*", Claims.CollectionEntriesCreate),
  Claims.collection("*", "*", "*", Claims.CollectionEntriesUpdate),
];
// Only `replace` deletes, so only `replace` asks for these.
const instanceWideReplace = [
  Claims.collection("*", "*", "*", Claims.CollectionDelete),
  Claims.collection("*", "*", "*", Claims.CollectionEntriesDelete),
];
// D24: an archive carries the media library and its catalog, so transfer also
// asks for the media permission it exercises — read to export, create to
// import, and delete on top of that in `replace`, which clears every blob in
// the instance before loading.
const transferMediaRead = [Claims.MediaRead];
const transferMediaWrite = [Claims.MediaCreate];
const transferMediaReplace = [Claims.MediaDelete];

describe("claims API authorization", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-claims-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    await service.collections.putSchema(Scope.Default, "posts", { type: "object", "x-silo-auth": true });
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("entry CRUD actions are enforced independently", async () => {
    const claims = [
      Claims.collection("default", "prod", "posts", Claims.CollectionSchemaRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesCreate),
    ];
    const { secret } = await service.keys.create("frontend", claims);
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
    const { secret } = await service.keys.create("delegator", [
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
    }, { usages: [], search: null });

    const response = await app.request("/api/keys", {
      headers: { Authorization: `Bearer ${rootKey}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ label: string; claims: string[] }> };
    expect(body.items.some((key) => key.label === "root" && key.claims.includes("*"))).toBe(true);
    expect(body.items.some((key) => key.label === "obsolete")).toBe(false);
  });

  test("bootstrap replaces an obsolete-only key set with a claims root", async () => {
    for (const key of await service.keys.list()) await service.keys.revoke(key.id);
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
    }, { usages: [], search: null });

    const secret = await service.keys.bootstrap();
    expect(secret.startsWith("silo_")).toBe(true);
    expect((await service.keys.authenticate(secret)).claims).toEqual([Claims.Root]);
  });

  test("changing public access needs its dedicated claim", async () => {
    const { secret } = await service.keys.create("schema editor", [
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
    const { secret } = await service.keys.create("exporter", [
      Claims.TransferExport,
      ...instanceWideRead,
      ...transferMediaRead,
    ]);
    const headers = { Authorization: `Bearer ${secret}` };
    expect((await app.request("/api/export", { headers })).status).toBe(200);
    expect((await app.request("/api/export?with_keys=true", { headers })).status).toBe(403);
  });

  test("key-bearing imports need the additional key claim", async () => {
    const archivePath = path.join(tempDir, "keys.tar.gz");
    await service.transfer.exportTarGz(archivePath, { withKeys: true });
    const archive = await fs.readFile(archivePath);
    const { secret: dataOnly } = await service.keys.create("data importer", [
      Claims.TransferImport,
      ...instanceWideWrite,
      ...transferMediaWrite,
    ]);
    const { secret: withKeys } = await service.keys.create("key importer", [
      Claims.TransferImport,
      Claims.KeysImport,
      ...instanceWideWrite,
      ...transferMediaWrite,
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
    await service.collections.putSchema(Scope.Default, "public_posts", { type: "object" });
    await service.collections.putSchema(Scope.Default, "public_pages", { type: "object" });
    await service.entries.create(Scope.Default, "public_posts", { title: "public" });
    const { secret } = await service.keys.create("posts reader", [
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

    await service.collections.putSchema(scopeAcmeProd, "articles", { type: "object", "x-silo-auth": true });
    await service.collections.putSchema(scopeAcmeDev, "articles", { type: "object", "x-silo-auth": true });
    await service.collections.putSchema(scopeOtherProd, "articles", { type: "object", "x-silo-auth": true });

    await service.entries.create(scopeAcmeProd, "articles", { title: "Acme Prod" });
    await service.entries.create(scopeAcmeDev, "articles", { title: "Acme Dev" });
    await service.entries.create(scopeOtherProd, "articles", { title: "Other Prod" });

    // Key with acme/prod/*
    const { secret: keyProd } = await service.keys.create("acme prod key", [
      Claims.collection("acme", "prod", "*", Claims.CollectionEntriesRead),
    ]);
    const headersProd = { Authorization: `Bearer ${keyProd}` };

    expect((await app.request("/api/projects/acme/envs/prod/collections/articles", { headers: headersProd })).status).toBe(200);
    expect((await app.request("/api/projects/acme/envs/dev/collections/articles", { headers: headersProd })).status).toBe(403);
    expect((await app.request("/api/projects/other/envs/prod/collections/articles", { headers: headersProd })).status).toBe(403);

    // Key with acme/*/* (all envs in acme)
    const { secret: keyAcmeAll } = await service.keys.create("acme all key", [
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
    const { secret: scopedExport } = await service.keys.create("acme exporter", [
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

    const { secret: scopedImport } = await service.keys.create("acme importer", [
      Claims.TransferImport,
      Claims.collection("acme", "*", "*", Claims.CollectionCreate),
      Claims.collection("acme", "*", "*", Claims.CollectionSchemaUpdate),
      Claims.collection("acme", "*", "*", Claims.CollectionEntriesCreate),
      Claims.collection("acme", "*", "*", Claims.CollectionEntriesUpdate),
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
    const { secret: wide } = await service.keys.create("instance exporter", [
      Claims.TransferExport,
      ...instanceWideRead,
      ...transferMediaRead,
    ]);
    expect(
      (await app.request("/api/export", { headers: { Authorization: `Bearer ${wide}` } })).status,
    ).toBe(200);
  });

  test("importing needs the schema permissions the apply stage exercises", async () => {
    // The apply stage calls `putSchema` for every collection an archive
    // carries, in both modes, and creates the collections and scopes it names.
    // Entry permissions alone therefore used to buy a key the authority to
    // overwrite every schema in the instance without holding `schema:update`
    // at any scope (D21).
    const archivePath = path.join(tempDir, "data.tar.gz");
    await service.transfer.exportTarGz(archivePath, { withKeys: false });
    const archive = await fs.readFile(archivePath);

    const attempt = async (claims: string[]) => {
      const { secret } = await service.keys.create(`importer ${claims.length}`, claims);
      const response = await app.request("/api/import?dry_run=true", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/gzip" },
        body: archive,
      });
      const body = (await response.json()) as any;
      return { status: response.status, message: body?.error?.message ?? "" };
    };

    const entryPermissions = [
      Claims.collection("*", "*", "*", Claims.CollectionEntriesCreate),
      Claims.collection("*", "*", "*", Claims.CollectionEntriesUpdate),
      Claims.collection("*", "*", "*", Claims.CollectionEntriesDelete),
    ];

    // The three entry permissions were the whole of the old list.
    const entriesOnly = await attempt([Claims.TransferImport, ...entryPermissions]);
    expect(entriesOnly.status).toBe(403);
    expect(entriesOnly.message).toContain(Claims.CollectionCreate);

    // The guard names the first permission it finds missing, so add `create`
    // to show `schema:update` is required in its own right and not merely
    // shadowed by the one reported above.
    const noSchemaWrite = await attempt([
      Claims.TransferImport,
      Claims.collection("*", "*", "*", Claims.CollectionCreate),
      ...entryPermissions,
    ]);
    expect(noSchemaWrite.status).toBe(403);
    expect(noSchemaWrite.message).toContain(Claims.CollectionSchemaUpdate);

    const { secret: full } = await service.keys.create("importer", [
      Claims.TransferImport,
      ...instanceWideWrite,
      ...transferMediaWrite,
    ]);
    expect(
      (await app.request("/api/import?dry_run=true", {
        method: "POST",
        headers: { Authorization: `Bearer ${full}`, "Content-Type": "application/gzip" },
        body: archive,
      })).status,
    ).toBe(200);
  });

  test('"replace" mode needs the delete permissions merge does not', async () => {
    const archivePath = path.join(tempDir, "replace.tar.gz");
    await service.transfer.exportTarGz(archivePath, { withKeys: false });
    const archive = await fs.readFile(archivePath);

    const request = (secret: string, mode: string) =>
      app.request(`/api/import?dry_run=true&mode=${mode}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/gzip" },
        body: archive,
      });

    const { secret: mergeOnly } = await service.keys.create("merge importer", [
      Claims.TransferImport,
      ...instanceWideWrite,
      ...transferMediaWrite,
    ]);
    expect((await request(mergeOnly, "merge")).status).toBe(200);
    const denied = await request(mergeOnly, "replace");
    expect(denied.status).toBe(403);
    expect((await denied.json()) as any).toMatchObject({
      error: { message: expect.stringContaining(Claims.CollectionDelete) },
    });

    const { secret: replacer } = await service.keys.create("replace importer", [
      Claims.TransferImport,
      ...instanceWideWrite,
      ...transferMediaWrite,
      ...instanceWideReplace,
      ...transferMediaReplace,
    ]);
    expect((await request(replacer, "replace")).status).toBe(200);

    // An unrecognised mode is not `replace`, so it clears the write guard and
    // is then rejected on its own terms rather than silently treated as one.
    expect((await request(mergeOnly, "REPLACE")).status).toBe(400);
  });

  test("transfer claims do not confer media authority (D24)", async () => {
    // D21 gated the mechanism on holding, at instance scope, the collection
    // permissions the operation exercises — and deferred media. It is the one
    // surface where `transfer:import` alone could still write, and in
    // `replace` wipe, every blob in the instance. These assertions are the
    // closing of that hole: each key holds everything the operation needs
    // except the media claim it exercises.
    const { secret: exportNoMedia } = await service.keys.create("export sans media", [
      Claims.TransferExport,
      ...instanceWideRead,
    ]);
    expect(
      (await app.request("/api/export", { headers: { Authorization: `Bearer ${exportNoMedia}` } }))
        .status,
    ).toBe(403);

    const archivePath = path.join(tempDir, "d24.tar.gz");
    await service.transfer.exportTarGz(archivePath, { withKeys: false });
    const archive = await fs.readFile(archivePath);
    const post = (secret: string, query = "") =>
      app.request(`/api/import${query}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/gzip" },
        body: archive,
      });

    const { secret: importNoMedia } = await service.keys.create("import sans media", [
      Claims.TransferImport,
      ...instanceWideWrite,
    ]);
    expect((await post(importNoMedia, "?dry_run=true")).status).toBe(403);

    // Holds media:create, so merge is allowed — but `replace` clears every
    // blob, and that needs media:delete on top, split by mode exactly as D21
    // splits its own list.
    const { secret: mergeOnly } = await service.keys.create("merge sans media delete", [
      Claims.TransferImport,
      ...instanceWideWrite,
      ...instanceWideReplace,
      ...transferMediaWrite,
    ]);
    expect((await post(mergeOnly, "?mode=merge&dry_run=true")).status).toBe(200);
    expect((await post(mergeOnly, "?mode=replace&dry_run=true")).status).toBe(403);
  });
});
