import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { SystemCollections } from "../../src/core/domain/system-collections";
import { KeyUtils } from "../../src/core/keys/key-utils";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * The three rename routes, their authority, and the claim cascade behind them
 * (D51).
 */
describe("rename API", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  const scope = Scope.of("acme", "dev");

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-rename-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();
    await service.collections.putSchema(scope, "posts", { type: "object" });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const auth = (key: string) => ({
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  });

  const patch = (url: string, key: string, name: string) =>
    app.request(url, { method: "PATCH", headers: auth(key), body: JSON.stringify({ name }) });

  const claimsOf = async (id: string): Promise<string[]> =>
    (await store.get(Scope.System, SystemCollections.Keys, id)).data.claims;

  describe("routes", () => {
    test("renames a project, an environment and a collection", async () => {
      expect((await patch("/api/projects/acme", rootKey, "globex")).status).toBe(200);
      expect((await patch("/api/projects/globex/environments/dev", rootKey, "staging")).status).toBe(
        200,
      );
      const collection = await patch(
        "/api/projects/globex/environments/staging/collections/posts",
        rootKey,
        "articles",
      );
      expect(collection.status).toBe(200);

      expect((await store.listScopes()).map((s) => s.key())).toEqual(["globex/staging"]);
      expect(
        (await store.listCollections(Scope.of("globex", "staging"))).map((c) => c.name),
      ).toEqual(["articles"]);
    });

    test("the /envs spelling is registered with the same authority", async () => {
      expect((await patch("/api/projects/acme/envs/dev", rootKey, "staging")).status).toBe(200);
      expect((await store.listScopes()).map((s) => s.key())).toEqual(["acme/staging"]);
    });

    test("a body with no name is a 400", async () => {
      const response = await app.request("/api/projects/acme", {
        method: "PATCH",
        headers: auth(rootKey),
        body: JSON.stringify({ id: "globex" }),
      });
      expect(response.status).toBe(400);
    });

    test("an unknown name is a 404 and an invalid one a 400", async () => {
      expect((await patch("/api/projects/nosuch", rootKey, "globex")).status).toBe(404);
      expect((await patch("/api/projects/acme", rootKey, "Nope!")).status).toBe(400);
    });

    test("expected_id refuses a request aimed at a record that has been replaced", async () => {
      const original = (await store.findProject("acme"))!.id;
      await patch("/api/projects/acme", rootKey, "globex");
      // Something else takes the freed name; a delayed request naming `acme`
      // must not rename it.
      await service.scopes.createProject("acme");

      const stale = await app.request(`/api/projects/acme?expected_id=${original}`, {
        method: "PATCH",
        headers: auth(rootKey),
        body: JSON.stringify({ name: "other" }),
      });
      expect(stale.status).toBe(409);
      expect((await store.findProject("acme"))!.id).not.toBe(original);
    });

    test("dry_run reports what would change and writes nothing", async () => {
      const { entry } = await service.keys.create("scoped", [
        Claims.collection("acme", "dev", "posts", Claims.CollectionEntriesRead),
      ]);

      const response = await app.request("/api/projects/acme?dry_run=true", {
        method: "PATCH",
        headers: auth(rootKey),
        body: JSON.stringify({ name: "globex" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        from: "acme",
        to: "globex",
        rewritten_claims: ["collections:acme/dev/posts:entries:read"],
        pattern_affected_claims: [],
      });

      // Nothing moved.
      expect(await store.findProject("acme")).not.toBeNull();
      expect(await claimsOf(entry.id)).toEqual(["collections:acme/dev/posts:entries:read"]);
    });
  });

  describe("authority", () => {
    const mint = async (claims: string[]) => (await service.keys.create("k", claims)).secret;

    test("a rename needs create *and* delete at the subject's reach", async () => {
      const createOnly = await mint([
        Claims.collection("acme", "*", "*", Claims.CollectionCreate),
      ]);
      expect((await patch("/api/projects/acme", createOnly, "globex")).status).toBe(403);

      const deleteOnly = await mint([
        Claims.collection("acme", "*", "*", Claims.CollectionDelete),
      ]);
      expect((await patch("/api/projects/acme", deleteOnly, "globex")).status).toBe(403);

      // Both permissions, and at both names — the next test is about that
      // second half on its own.
      const both = await mint([
        Claims.collection("acme", "*", "*", Claims.CollectionCreate),
        Claims.collection("acme", "*", "*", Claims.CollectionDelete),
        Claims.collection("globex", "*", "*", Claims.CollectionCreate),
        Claims.collection("globex", "*", "*", Claims.CollectionDelete),
      ]);
      expect((await patch("/api/projects/acme", both, "globex")).status).toBe(200);
    });

    test("the new name is checked too, not only the old one", async () => {
      // Otherwise a key scoped to `acme` could move a project into a namespace
      // it holds nothing for.
      const acmeOnly = await mint([
        Claims.collection("acme", "*", "*", Claims.CollectionCreate),
        Claims.collection("acme", "*", "*", Claims.CollectionDelete),
      ]);
      expect((await patch("/api/projects/acme", acmeOnly, "globex")).status).toBe(403);
      expect(await store.findProject("acme")).not.toBeNull();
    });

    test("a collection rename needs schema:update on every referring collection", async () => {
      await service.collections.putSchema(scope, "authors", {
        type: "object",
        properties: { post: { $ref: "silo://collections/posts" } },
      });

      const withoutReferrer = await mint([
        Claims.collection("acme", "dev", "posts", Claims.CollectionCreate),
        Claims.collection("acme", "dev", "posts", Claims.CollectionDelete),
        Claims.collection("acme", "dev", "articles", Claims.CollectionCreate),
        Claims.collection("acme", "dev", "articles", Claims.CollectionDelete),
      ]);
      expect(
        (
          await patch(
            "/api/projects/acme/environments/dev/collections/posts",
            withoutReferrer,
            "articles",
          )
        ).status,
      ).toBe(403);
    });
  });

  describe("the claim cascade", () => {
    test("a literal claim follows the rename and a wildcard one is only reported", async () => {
      const { entry: scoped } = await service.keys.create("scoped", [
        Claims.collection("acme", "dev", "posts", Claims.CollectionEntriesRead),
      ]);
      const { entry: pattern } = await service.keys.create("pattern", [
        Claims.collection("*", "dev", "*", Claims.CollectionEntriesRead),
      ]);
      const { entry: wide } = await service.keys.create("wide", [
        Claims.collection("*", "*", "*", Claims.CollectionEntriesRead),
      ]);

      const response = await patch("/api/projects/acme/environments/dev", rootKey, "staging");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        rewritten_claims: ["collections:acme/dev/posts:entries:read"],
        pattern_affected_claims: ["collections:*/dev/*:entries:read"],
      });

      expect(await claimsOf(scoped.id)).toEqual([
        "collections:acme/staging/posts:entries:read",
      ]);
      // Never rewritten: `*/staging/*` would change authority in every project.
      expect(await claimsOf(pattern.id)).toEqual(["collections:*/dev/*:entries:read"]);
      expect(await claimsOf(wide.id)).toEqual(["collections:*/*/*:entries:read"]);
    });

    test("hook claims are rewritten alongside collection claims", async () => {
      const { entry } = await service.keys.create("hooked", [
        Claims.collection("acme", "dev", "posts", Claims.CollectionEntriesRead),
        Claims.hook("acme", "dev", "posts", "entry.afterWrite"),
      ]);

      await patch("/api/projects/acme/environments/dev", rootKey, "staging");

      expect(await claimsOf(entry.id)).toEqual([
        "collections:acme/staging/posts:entries:read",
        "hooks:acme/staging/posts:entry.afterWrite",
      ]);
    });

    test("the rename is audited with both claim lists", async () => {
      await service.keys.create("scoped", [
        Claims.collection("acme", "dev", "posts", Claims.CollectionEntriesRead),
      ]);
      await service.keys.create("pattern", [
        Claims.collection("*", "dev", "*", Claims.CollectionEntriesRead),
      ]);

      await patch("/api/projects/acme/environments/dev", rootKey, "staging");

      const trail = await service.audit.list({ limit: 50, offset: 0 });
      const event = trail.items.find((item) => item.action === "environment.rename");
      expect(event).toBeDefined();
      expect(event!.detail).toMatchObject({
        from: "dev",
        to: "staging",
        rewritten_claims: ["collections:acme/dev/posts:entries:read"],
        pattern_affected_claims: ["collections:*/dev/*:entries:read"],
      });
    });

    test("a pending cascade reserves the old name until it finishes", async () => {
      // Staged by hand, standing in for a crash between the record rename and
      // the claim rewrite.
      await store.put(
        {
          id: "01PENDINGPENDINGPENDINGPE",
          project: Scope.System.project,
          env: Scope.System.env,
          collection: SystemCollections.ScopeRenames,
          rev: 1,
          seq: 0,
          created_at: new Date(),
          updated_at: new Date(),
          data: {
            rename: { subject: "project", from: "held", to: "moved", project: "held" },
            keys: [],
            plugins: [],
          },
        },
        { usages: [], search: null },
      );

      await expect(service.scopes.createProject("held")).rejects.toThrow(/rename/);
      // A different name is unaffected.
      await service.scopes.createProject("free");
    });

    test("a crashed cascade is finished at the next start, idempotently", async () => {
      const { entry } = await service.keys.create("scoped", [
        Claims.collection("acme", "dev", "posts", Claims.CollectionEntriesRead),
      ]);

      // The record rename landed; the claim rewrite did not. This is exactly
      // the state the marker exists to describe.
      const project = (await store.findProject("acme"))!;
      await store.renameProject(project.id, "globex");
      await store.put(
        {
          id: "01RESUMERESUMERESUMERESUM",
          project: Scope.System.project,
          env: Scope.System.env,
          collection: SystemCollections.ScopeRenames,
          rev: 1,
          seq: 0,
          created_at: new Date(),
          updated_at: new Date(),
          data: {
            rename: { subject: "project", from: "acme", to: "globex", project: "acme" },
            keys: [entry.id],
            plugins: [],
          },
        },
        { usages: [], search: null },
      );

      expect(await service.resumePendingRenames()).toEqual({ resumed: 1, failed: 0 });
      expect(await claimsOf(entry.id)).toEqual(["collections:globex/dev/posts:entries:read"]);

      // The marker is cleared, so the name is released and a second resume has
      // nothing to do.
      expect(await service.resumePendingRenames()).toEqual({ resumed: 0, failed: 0 });
      await service.scopes.createProject("acme");
    });

    test("silo.toml declaring a matching claim refuses the rename outright", async () => {
      // Effective plugin authority is config ∪ record, and D34 forbids the API
      // writing `[[plugins]]` — so the rename says so and stops rather than
      // completing three quarters of an authority change.
      service.renames.useDeclaredPluginClaims(
        new Map([["mirror", ["collections:acme/dev/posts:entries:read"]]]),
      );

      const response = await patch("/api/projects/acme/environments/dev", rootKey, "staging");
      expect(response.status).toBe(409);
      expect(await response.text()).toContain("mirror");
      // Nothing moved.
      expect(await store.findEnvironment("acme", "dev")).not.toBeNull();
    });
  });

  describe("collection renames rewrite the schema graph", () => {
    test("referring $refs and their bundled $defs are rebuilt", async () => {
      await service.collections.putSchema(scope, "authors", {
        type: "object",
        properties: { post: { $ref: "silo://collections/posts" } },
      });

      expect(
        (await patch("/api/projects/acme/environments/dev/collections/posts", rootKey, "articles"))
          .status,
      ).toBe(200);

      const authors = await service.collections.get(scope, "authors");
      expect(authors.schema.properties.post.$ref).toBe("silo://collections/articles");
      // The bundler keys `$defs` by collection name, so the old key must be
      // gone and the new one present — a `$ref` rewrite alone would leave both.
      expect(Object.keys(authors.schema.$defs ?? {})).toEqual(["articles"]);
    });

    test("a self-reference is rewritten too", async () => {
      await service.collections.putSchema(scope, "posts", {
        type: "object",
        properties: { parent: { $ref: "silo://collections/posts" } },
      });

      expect(
        (await patch("/api/projects/acme/environments/dev/collections/posts", rootKey, "articles"))
          .status,
      ).toBe(200);

      const articles = await service.collections.get(scope, "articles");
      expect(articles.schema.properties.parent.$ref).toBe("silo://collections/articles");
      expect(Object.keys(articles.schema.$defs ?? {})).toEqual(["articles"]);
    });

    test("entries survive the rename and read under the new name", async () => {
      const created = await service.entries.create(scope, "posts", { title: "x" });

      await patch("/api/projects/acme/environments/dev/collections/posts", rootKey, "articles");

      const read = await service.entries.get(scope, "articles", created.id);
      expect(read.data).toEqual({ title: "x" });
      expect(read.seq).toBe(created.seq);
      await expect(service.entries.get(scope, "posts", created.id)).rejects.toThrow();
    });
  });

  test("a managed key's claims are not left naming a scope that is gone", async () => {
    // `_keys` is the collection the cascade rewrites, so the guard is that the
    // rewrite reaches every record in it rather than only the ones a route
    // happened to mint.
    const { entry } = await service.keys.create("worker", [
      Claims.collection("acme", "dev", "posts", Claims.CollectionEntriesUpdate),
    ]);
    expect((await store.get(Scope.System, KeyUtils.KeysCollection, entry.id)).data.claims).toEqual([
      "collections:acme/dev/posts:entries:update",
    ]);

    await patch("/api/projects/acme", rootKey, "globex");

    expect(await claimsOf(entry.id)).toEqual(["collections:globex/dev/posts:entries:update"]);
  });
});
