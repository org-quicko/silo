import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { MediaRefs } from "../../src/core/media/media-refs";
import { SearchText } from "../../src/core/search/search-text";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * The two halves D54 split apart: a listing that names collections and counts
 * their entries, and a separate route for the schemas.
 */
describe("the collections listing", () => {
  const scope = Scope.Default;
  const base = "/api/projects/default/environments/prod";
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  const addEntry = async (collection: string, data: any) => {
    const entry = {
      id: crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase(),
      project: scope.project,
      env: scope.env,
      collection,
      rev: 1,
      seq: 0,
      created_at: new Date(),
      updated_at: new Date(),
      data,
    };
    await store.put(entry, { usages: MediaRefs.extract(data), search: SearchText.extract(data) });
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-collections-api-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store);
    app = new SiloServer(service, {
      version: "test",
      authDisabled: true,
      logger: Logger.silent(),
    }).build();

    await service.collections.putSchema(scope, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
    });
    await service.collections.putSchema(scope, "authors", { type: "object" });
    await addEntry("posts", { title: "one" });
    await addEntry("posts", { title: "two" });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("names each collection, counts its entries, and carries no schema", async () => {
    const response = await app.request(`${base}/collections`);
    expect(response.status).toBe(200);

    const { items } = (await response.json()) as any;
    expect(items.map((item: any) => item.name)).toEqual(["authors", "posts"]);

    const posts = items.find((item: any) => item.name === "posts");
    expect(posts.entries).toBe(2);
    expect(posts.requires_auth).toBe(false);
    expect(typeof posts.id).toBe("string");
    expect(Date.parse(posts.created_at)).not.toBeNaN();
    expect(Date.parse(posts.updated_at)).not.toBeNaN();

    // The point of the split: no listing carries a schema, however large.
    for (const item of items) expect(item).not.toHaveProperty("schema");
  });

  test("an empty collection counts zero rather than going missing", async () => {
    const { items } = (await (await app.request(`${base}/collections`)).json()) as any;
    expect(items.find((item: any) => item.name === "authors").entries).toBe(0);
  });

  test("a collection that turned on x-silo-auth says so", async () => {
    await service.collections.putSchema(scope, "private", {
      type: "object",
      "x-silo-auth": true,
    });

    const { items } = (await (await app.request(`${base}/collections`)).json()) as any;
    expect(items.find((item: any) => item.name === "private").requires_auth).toBe(true);
    expect(items.find((item: any) => item.name === "posts").requires_auth).toBe(false);
  });

  test("the schemas route answers them all, and the /envs alias with it", async () => {
    for (const alias of ["environments", "envs"]) {
      const response = await app.request(`/api/projects/default/${alias}/prod/schemas`);
      expect(response.status).toBe(200);

      const { items } = (await response.json()) as any;
      expect(items.map((item: any) => item.name)).toEqual(["authors", "posts"]);
      expect(items.find((item: any) => item.name === "posts").schema.properties).toEqual({
        title: { type: "string" },
      });
    }
  });

  // `putSchema` bundles, so a stored schema is self-contained as of *its own*
  // last save — which is not the same as being self-contained. A referenced
  // collection that has changed shape since is embedded as it was then, and a
  // client rendering the stored copy would draw the wrong form.
  test("one collection's schema is bundled as of now, not as of its last save", async () => {
    await service.collections.putSchema(scope, "writers", {
      type: "object",
      properties: { pen_name: { type: "string" } },
    });
    await service.collections.putSchema(scope, "articles", {
      type: "object",
      properties: { author: { $ref: "silo://collections/writers" } },
    });

    // The referenced collection grows a field after the referrer was saved.
    await service.collections.putSchema(scope, "writers", {
      type: "object",
      properties: { pen_name: { type: "string" }, agency: { type: "string" } },
    });

    const stored = await service.collections.get(scope, "articles");
    expect(stored.schema.$defs.writers.properties).not.toHaveProperty("agency");

    const body = (await (await app.request(`${base}/collections/articles/schema`)).json()) as any;
    expect(Object.keys(body.schema.$defs.writers.properties).sort()).toEqual([
      "agency",
      "pen_name",
    ]);

    // Resolved on the way out — the record itself is not rewritten.
    const after = await service.collections.get(scope, "articles");
    expect(after.schema.$defs.writers.properties).not.toHaveProperty("agency");
  });

  // `schemas` is a legal collection name, which is why the bulk route is a
  // sibling of `collections` and not a path beneath it: under `/collections/`
  // it would have shadowed this collection's own entry list.
  test("a collection actually named schemas keeps its own entry list", async () => {
    await service.collections.putSchema(scope, "schemas", { type: "object" });
    await addEntry("schemas", { title: "mine" });

    const response = await app.request(`${base}/collections/schemas`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.total).toBe(1);
    expect(body.data[0].title).toBe("mine");
  });
});
