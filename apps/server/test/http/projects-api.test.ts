import { CollectionSchemas } from "../../src/core/schema/collection-schemas";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { Exporter } from "../../src/core/transfer/exporter";
import { Importer } from "../../src/core/transfer/importer";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/** Listings answer records since D51: `{id, name}`, where `id` is the ULID and
 *  `name` is what every path addresses. */
const names = (items: readonly { name: string }[]): string[] =>
  items.map((item) => item.name);

describe("Projects API", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-projects-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("GET /api/projects and GET /api/projects/:project/environments list projects and envs", async () => {
    const scopeAcmeProd = Scope.of("acme", "prod");
    const scopeAcmeDev = Scope.of("acme", "dev");

    await service.collections.putSchema(scopeAcmeProd, "posts", { type: "object", "x-silo-auth": true });
    await service.collections.putSchema(scopeAcmeDev, "posts", { type: "object", "x-silo-auth": false });
    await service.scopes.createProject("empty");
    await service.scopes.createEnvironment("empty", "staging");

    // Root sees all projects
    const rootHeaders = { Authorization: `Bearer ${rootKey}` };
    const rootRes = await app.request("/api/projects", { headers: rootHeaders });
    expect(rootRes.status).toBe(200);
    const rootBody = (await rootRes.json()) as { items: { id: string; name: string }[] };
    expect(names(rootBody.items).sort()).toEqual(["acme", "empty"]);

    // Root sees all environments in acme
    const acmeEnvsRes = await app.request("/api/projects/acme/environments", { headers: rootHeaders });
    expect(acmeEnvsRes.status).toBe(200);
    const acmeEnvsBody = (await acmeEnvsRes.json()) as { items: { id: string; name: string }[] };
    expect(names(acmeEnvsBody.items).sort()).toEqual(["dev", "prod"]);

    // Scoped key with acme/*/* sees acme project
    const { secret: acmeKey } = await service.keys.create("acme key", [
      Claims.collection("acme", "*", "*", Claims.CollectionSchemaRead),
    ]);
    const acmeRes = await app.request("/api/projects", {
      headers: { Authorization: `Bearer ${acmeKey}` },
    });
    expect(acmeRes.status).toBe(200);
    const acmeBody = (await acmeRes.json()) as { items: { id: string; name: string }[] };
    expect(names(acmeBody.items)).toEqual(["acme"]);

    // Anonymous sees only projects with public collections (acme)
    const anonRes = await app.request("/api/projects");
    expect(anonRes.status).toBe(200);
    const anonBody = (await anonRes.json()) as { items: { id: string; name: string }[] };
    expect(names(anonBody.items)).toEqual(["acme"]);
  });

  test("POST /api/projects and POST /api/projects/:project/environments creates projects and envs", async () => {
    const { secret: creatorKey } = await service.keys.create("creator", [
      Claims.collection("myproject", "*", "*", Claims.CollectionCreate),
    ]);
    const response = await app.request("/api/projects", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creatorKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: "myproject" }),
    });
    expect(response.status).toBe(201);
    // `id` is the ULID now and `name` is what the path addresses (D51), where
    // the create response used to answer the name as `id`.
    expect(await response.json()).toMatchObject({ name: "myproject" });

    // Create environment
    const envRes = await app.request("/api/projects/myproject/environments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creatorKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: "myenv" }),
    });
    expect(envRes.status).toBe(201);
    expect(await envRes.json()).toMatchObject({ name: "myenv" });

    // Verify it surfaces in GET /api/projects
    const listRes = await app.request("/api/projects", {
      headers: { Authorization: `Bearer ${creatorKey}` },
    });
    const listBody = (await listRes.json()) as { items: { id: string; name: string }[] };
    expect(names(listBody.items)).toContain("myproject");
  });

  test("POST /api/projects rejects unauthorized or invalid requests", async () => {
    const { secret: unauthKey } = await service.keys.create("unauth", [
      Claims.collection("other", "*", "*", Claims.CollectionCreate),
    ]);

    // Unauthorized project
    const forbidden = await app.request("/api/projects", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${unauthKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: "forbidden" }),
    });
    expect(forbidden.status).toBe(403);

    // Invalid project ID
    const rootHeaders = {
      Authorization: `Bearer ${rootKey}`,
      "Content-Type": "application/json",
    };
    const invalidId = await app.request("/api/projects", {
      method: "POST",
      headers: rootHeaders,
      body: JSON.stringify({ id: "Invalid_Project_Name" }),
    });
    expect(invalidId.status).toBe(400);
  });

  test("DELETE /api/projects/:project/environments/:env deletes environment and collections", async () => {
    const scope = Scope.of("temp", "test");
    await service.scopes.createProject(scope.project);
    await service.scopes.createEnvironment(scope.project, scope.env);
    await service.collections.putSchema(scope, "notes", { type: "object" });
    await service.entries.create(scope, "notes", { content: "hello" });

    const rootHeaders = { Authorization: `Bearer ${rootKey}` };
    const deleteRes = await app.request("/api/projects/temp/environments/test?force=true", {
      method: "DELETE",
      headers: rootHeaders,
    });
    expect(deleteRes.status).toBe(204);

    const listRes = await app.request("/api/projects/temp/environments", { headers: rootHeaders });
    const listBody = (await listRes.json()) as { items: { id: string; name: string }[] };
    expect(names(listBody.items).includes("test")).toBe(false);
  });

  test("distinguishes projects and envs with underscores", async () => {
    await service.scopes.createProject("a_b");
    await service.scopes.createEnvironment("a_b", "c");
    await service.scopes.createProject("a");
    await service.scopes.createEnvironment("a", "b_c");

    const scopes = await service.scopes.list();
    expect(scopes.map((scope) => scope.key()).sort()).toEqual(["a/b_c", "a_b/c"]);

    // Deleting one must not take the other with it.
    await service.scopes.deleteEnvironment("a_b", "c", false);
    expect((await service.scopes.list()).map((scope) => scope.key())).toEqual(["a/b_c"]);
  });

  test("DELETE without force refuses up front instead of half-deleting", async () => {
    const scope = Scope.of("proj", "env");
    await service.scopes.createProject(scope.project);
    await service.scopes.createEnvironment(scope.project, scope.env);
    await service.collections.putSchema(scope, "aaa", { type: "object" });
    await service.collections.putSchema(scope, "bbb", { type: "object" });
    await service.entries.create(scope, "bbb", { x: 1 });

    const response = await app.request("/api/projects/proj/environments/env", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${rootKey}` },
    });
    expect(response.status).toBe(409);
    expect((await response.json()) as any).toMatchObject({
      error: { message: expect.stringContaining('"bbb" (1)') },
    });

    // Nothing was deleted — the empty collection ordered before the
    // conflicting one must still be there.
    const remaining = (await service.collections.list(scope)).map((c) => c.name);
    expect(remaining).toEqual(["aaa", "bbb"]);
  });

  test("an entry cannot be written into a collection that has no schema", async () => {
    const scope = Scope.of("orph", "env");
    const entry = {
      id: EntryUtils.newID(),
      project: scope.project,
      env: scope.env,
      collection: "ghost",
      rev: 1,
      seq: 0,
      created_at: new Date(),
      updated_at: new Date(),
      data: { a: 1 },
    };

    // The state this test used to construct — a collection holding entries and
    // no schema — is unrepresentable since D51, because a collection is a record
    // whose schema is NOT NULL. It is refused rather than silently accepted.
    await expect(store.put(entry, { usages: [], search: null })).rejects.toThrow(/not found/);
    expect(await store.listScopes()).toEqual([]);

    await store.putSchema(scope, "ghost", { type: "object" });
    await store.put(entry, { usages: [], search: null });

    const rootHeaders = { Authorization: `Bearer ${rootKey}` };
    const response = await app.request("/api/projects/orph/environments/env?force=true", {
      method: "DELETE",
      headers: rootHeaders,
    });
    expect(response.status).toBe(204);
    expect(await store.listScopes()).toEqual([]);

    // The project record outlives its last environment: existence is the record
    // now, not the content, so only `DELETE /api/projects/orph` removes it.
    const listRes = await app.request("/api/projects", { headers: rootHeaders });
    expect(names(((await listRes.json()) as any).items)).toEqual(["orph"]);
  });

  test("a registered empty project survives an export/import round trip", async () => {
    await service.scopes.createProject("empty");
    await service.scopes.createEnvironment("empty", "staging");
    await service.collections.putSchema(Scope.of("acme", "prod"), "posts", { type: "object" });

    const archive = path.join(tempDir, "export");
    await Exporter.exportDir(store, archive, {});

    const destDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-projects-dest-"));
    const destStore = await SqliteStore.open(path.join(destDir, "silo.db"));
    try {
      const destinationService = new SiloService(destStore, { mediaDir: path.join(destDir, "media") });
      await Importer.importDir(destStore, archive, { mode: "replace" });

      expect((await destinationService.scopes.list()).map((scope) => scope.key()).sort()).toEqual([
        "acme/prod",
        "empty/staging",
      ]);
    } finally {
      await destStore.close();
      await fs.rm(destDir, { recursive: true, force: true });
    }
  });

  // The schema-side mirror of the entry-only hole above. `Storage.putSchema`
  // has no collection-name check (only `SiloService.putSchema` does), and the
  // import path calls it directly — so an archive carrying
  // `schemas/_secret.schema.json` plants a system-named schema in a user
  // scope. `SiloService.listCollections` hides `_`-prefixed names, so building the
  // delete list from it left the scope alive with nothing the API could remove.
  test("DELETE erases system-named collections planted in a user scope", async () => {
    const scope = Scope.of("ghosty", "prod");
    await store.putSchema(scope, "_secret", { type: "object" });
    expect((await store.listScopes()).map((scope) => scope.key())).toContain("ghosty/prod");
    expect(await service.collections.list(scope)).toEqual([]);

    const rootHeaders = { Authorization: `Bearer ${rootKey}` };
    // `force` is required: the scope holds a collection, and that the
    // collection is invisible to `listCollections` does not make the delete
    // any less destructive.
    expect(
      (await app.request("/api/projects/ghosty/environments/prod", {
        method: "DELETE",
        headers: rootHeaders,
      })).status,
    ).toBe(409);

    const response = await app.request("/api/projects/ghosty/environments/prod?force=true", {
      method: "DELETE",
      headers: rootHeaders,
    });
    expect(response.status).toBe(204);

    expect([...(CollectionSchemas.map(await store.listCollections(scope))).keys()]).toEqual([]);
    expect(await store.listScopes()).toEqual([]);
    // The project record survives its last environment (D51), so the listing
    // still names it until the project itself is deleted.
    const listRes = await app.request("/api/projects", { headers: rootHeaders });
    expect(names(((await listRes.json()) as any).items)).toEqual(["ghosty"]);
  });

  // An archive used to be able to carry `content/<name>/` with no schema beside
  // it, and silo accepted it. A collection's schema is NOT NULL since D51, so
  // the archive is refused by name rather than filled in with a permissive
  // schema that would accept anything into a collection the operator believes is
  // validated.
  test("an archive with content and no schema is refused, naming the directory", async () => {
    const scope = Scope.of("acme", "prod");
    const entry = {
      id: EntryUtils.newID(),
      project: scope.project,
      env: scope.env,
      collection: "ghost",
      rev: 1,
      seq: 0,
      created_at: new Date(),
      updated_at: new Date(),
      data: { title: "has a schema" },
    };
    await store.putSchema(scope, "ghost", { type: "object" });
    await store.put(entry, { usages: [], search: null });

    const archive = path.join(tempDir, "orphan-export");
    await Exporter.exportDir(store, archive, {});
    const manifest = JSON.parse(await fs.readFile(path.join(archive, "manifest.json"), "utf8"));
    expect(manifest.collections["acme/prod/ghost"]).toBe(1);

    // The archive carries the collection's id beside its schema, so a round trip
    // preserves identity rather than minting a new one.
    const markers = await fs.readdir(
      path.join(archive, "projects", "acme", "prod", "schemas"),
    );
    expect(markers).toContain(".ghost.silo-collection");

    const destDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-orphan-dest-"));
    const destStore = await SqliteStore.open(path.join(destDir, "silo.db"));
    try {
      await Importer.importDir(destStore, archive, { mode: "replace" });
      const got = await destStore.get(scope, "ghost", entry.id);
      expect(got.data).toEqual({ title: "has a schema" });
      expect((await destStore.findCollection(scope, "ghost"))?.id).toBe(
        (await store.findCollection(scope, "ghost"))!.id,
      );

      // Now take the schema away and re-import: refused, by name.
      await fs.rm(path.join(archive, "projects", "acme", "prod", "schemas", "ghost.schema.json"));
      await expect(
        Importer.importDir(destStore, archive, { mode: "replace" }),
      ).rejects.toThrow(/content\/ghost\//);
    } finally {
      await destStore.close();
      await fs.rm(destDir, { recursive: true, force: true });
    }
  });

  test("an export with no registered projects writes no stray _projects directory", async () => {
    const archive = path.join(tempDir, "bare-export");
    await Exporter.exportDir(store, archive, {});
    const systemContent = path.join(archive, "projects", "_system", "_system", "content");
    expect(await fs.readdir(systemContent).catch(() => [])).toEqual([]);
  });

  test("startup refuses a default project or env the API could never address", async () => {
    // `--project`/`--env`, `default_project`/`default_env`, and
    // SILO_DEFAULT_* are caller-supplied ids. Creating one unchecked produced
    // a project that `GET /api/projects` listed, no scoped route could reach
    // (`Scope.of` rejects it at the boundary), and `deleteProject` then
    // refused to delete for the very same reason — unreachable and
    // unremovable, from one typo in an env var.
    await expect(service.scopes.initDefaults("default", "PROD")).rejects.toThrow(/invalid default scope/);
    await expect(service.scopes.initDefaults("My Project", "prod")).rejects.toThrow(/invalid default scope/);
    // `_`-prefixed ids are reserved for Scope.System and must not be
    // reachable through configuration either.
    await expect(service.scopes.initDefaults("_system", "_system")).rejects.toThrow(/invalid default scope/);
    expect(names(await service.scopes.listProjects())).toEqual([]);

    await service.scopes.initDefaults("default", "prod");
    expect(names(await service.scopes.listProjects())).toEqual(["default"]);
    expect(names(await service.scopes.listEnvironments("default"))).toEqual(["prod"]);
  });

  test("DELETE without force refuses a scope holding only empty collections", async () => {
    const scope = Scope.of("fresh", "prod");
    await service.scopes.createProject(scope.project);
    await service.scopes.createEnvironment(scope.project, scope.env);
    for (const name of ["posts", "authors", "tags"]) {
      await service.collections.putSchema(scope, name, { type: "object" });
    }

    const rootHeaders = { Authorization: `Bearer ${rootKey}` };
    const response = await app.request("/api/projects/fresh", { method: "DELETE", headers: rootHeaders });

    // A project that has been modelled but not filled in yet is the normal
    // state right after setup, and `force` guards the collections, not just
    // the rows in them.
    expect(response.status).toBe(409);
    expect((await response.json()) as any).toMatchObject({
      error: { message: expect.stringContaining('"posts" (0)') },
    });
    expect((await service.collections.list(scope)).map((c) => c.name)).toEqual([
      "authors",
      "posts",
      "tags",
    ]);

    expect(
      (await app.request("/api/projects/fresh?force=true", { method: "DELETE", headers: rootHeaders }))
        .status,
    ).toBe(204);
    expect(names(await service.scopes.listProjects())).toEqual([]);
  });

  test("DELETE project refuses up front rather than emptying earlier envs", async () => {
    // The conflicting env sorts last, so a check-then-erase loop would have
    // wiped "aaa" before discovering "zzz" and still reported failure.
    await service.scopes.createProject("multi");
    await service.collections.putSchema(Scope.of("multi", "aaa"), "posts", { type: "object" });
    await service.collections.putSchema(Scope.of("multi", "zzz"), "posts", { type: "object" });
    await service.entries.create(Scope.of("multi", "zzz"), "posts", { title: "keep me" });

    const response = await app.request("/api/projects/multi", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${rootKey}` },
    });
    expect(response.status).toBe(409);

    expect((await service.collections.list(Scope.of("multi", "aaa"))).map((c) => c.name)).toEqual([
      "posts",
    ]);
    expect((await service.entries.list(Scope.of("multi", "zzz"), "posts", {})).total).toBe(1);
  });

  test("a key sees only the projects its claims name", async () => {
    await service.collections.putSchema(Scope.of("public-site", "prod"), "posts", {
      type: "object",
      "x-silo-auth": true,
    });
    await service.collections.putSchema(Scope.of("secret-client", "prod"), "invoices", {
      type: "object",
      "x-silo-auth": true,
    });

    const listFor = async (secret: string) => {
      const response = await app.request("/api/projects", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      return names(((await response.json()) as { items: { name: string }[] }).items);
    };

    // A fixed claim says nothing about which projects its holder may see.
    // Counting it as instance-wide visibility handed the entire tenant list
    // to a key whose only power was reading the media library.
    const media = await service.keys.create("media only", [Claims.MediaRead]);
    expect(await listFor(media.secret)).toEqual([]);

    const scoped = await service.keys.create("public-site only", [
      Claims.collection("public-site", "prod", "*", Claims.CollectionEntriesRead),
    ]);
    expect(await listFor(scoped.secret)).toEqual(["public-site"]);

    expect(await listFor(rootKey)).toEqual(["public-site", "secret-client"]);

    // Everything here requires auth, so an anonymous caller sees nothing.
    const anon = await app.request("/api/projects");
    expect(names(((await anon.json()) as { items: { name: string }[] }).items)).toEqual([]);
  });

  test("anonymous listings show only projects and envs with a public collection", async () => {
    await service.collections.putSchema(Scope.of("open", "prod"), "posts", { type: "object" });
    await service.collections.putSchema(Scope.of("open", "staging"), "drafts", {
      type: "object",
      "x-silo-auth": true,
    });
    await service.collections.putSchema(Scope.of("closed", "prod"), "invoices", {
      type: "object",
      "x-silo-auth": true,
    });

    const items = async (path: string) =>
      names(((await (await app.request(path)).json()) as { items: { name: string }[] }).items);

    expect(await items("/api/projects")).toEqual(["open"]);
    expect(await items("/api/projects/open/environments")).toEqual(["prod"]);
    expect(await items("/api/projects/closed/environments")).toEqual([]);

    // The public-scope map is cached, so a schema change has to invalidate it.
    await service.collections.putSchema(Scope.of("closed", "prod"), "invoices", { type: "object" });
    expect(await items("/api/projects")).toEqual(["closed", "open"]);
  });
});
