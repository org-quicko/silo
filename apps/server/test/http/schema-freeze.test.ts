import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { FsBlobStorage } from "../../src/adapters/blob/fs-blob-storage";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * A collection's constraints are frozen while it holds entries (D70).
 *
 * The rule is about what *validates*, so the keywords that configure silo
 * rather than judge data stay editable — otherwise publishing a populated
 * collection would mean emptying it first.
 */
describe("schema freeze", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  const scope = Scope.of("acme", "prod");

  const posts = {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  };

  const putSchema = (schema: unknown, name = "posts") =>
    app.request(`/api/projects/acme/environments/prod/collections/${name}/schema`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${rootKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(schema),
    });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-schema-freeze-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { blobStorage: new FsBlobStorage(path.join(tempDir, "media")) });
    rootKey = await service.keys.bootstrap();
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();

    await service.scopes.createProject("acme");
    await service.scopes.createEnvironment("acme", "prod");
    await service.collections.putSchema(scope, "posts", posts);
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("an empty collection's schema changes freely", async () => {
    const response = await putSchema({
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string" } },
    });
    expect(response.status).toBe(200);
    expect((await service.collections.get(scope, "posts")).schema).toMatchObject({
      properties: { body: { type: "string" } },
    });
  });

  test("one entry freezes the fields", async () => {
    await service.entries.create(scope, "posts", { title: "first" });

    const response = await putSchema({
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string" } },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "conflict", message: expect.stringContaining('collection "posts" has 1 entry') },
    });
    // Refused, not partly applied.
    expect((await service.collections.get(scope, "posts")).schema).toMatchObject(posts);
  });

  test("the count in the message is the real one", async () => {
    await service.entries.create(scope, "posts", { title: "first" });
    await service.entries.create(scope, "posts", { title: "second" });

    const response = await putSchema({ type: "object", properties: {} });
    expect(await response.json()).toMatchObject({
      error: { message: expect.stringContaining('collection "posts" has 2 entries') },
    });
  });

  test("re-saving the same schema is allowed, whatever the key order", async () => {
    await service.entries.create(scope, "posts", { title: "first" });

    expect((await putSchema(posts)).status).toBe(200);
    expect(
      (
        await putSchema({
          required: ["title"],
          properties: { title: { type: "string" } },
          type: "object",
        })
      ).status
    ).toBe(200);
  });

  test("access, search and labels stay editable on a populated collection", async () => {
    await service.entries.create(scope, "posts", { title: "first" });

    const response = await putSchema({
      ...posts,
      title: "Posts",
      description: "the blog",
      "x-silo-auth": true,
      "x-silo-search": { label: ["$.data.title"] },
    });
    expect(response.status).toBe(200);

    const saved = await service.collections.get(scope, "posts");
    expect(saved.schema).toMatchObject({ "x-silo-auth": true, title: "Posts" });
    // And still the same constraints.
    expect(saved.schema).toMatchObject({ required: ["title"] });
  });

  test("deleting the entries thaws it again", async () => {
    const entry = await service.entries.create(scope, "posts", { title: "first" });
    expect((await putSchema({ type: "object", properties: {} })).status).toBe(409);

    await service.entries.delete(scope, "posts", entry.id, entry.rev);
    expect((await putSchema({ type: "object", properties: {} })).status).toBe(200);
  });

  test("a rename still repoints refs into a populated collection", async () => {
    // A rename changes the *name* the constraints are written under, not the
    // constraints, so the freeze must not block it — and the referring schema
    // it rewrites may itself be populated.
    await service.collections.putSchema(scope, "authors", { type: "object" });
    await service.collections.putSchema(scope, "posts", {
      ...posts,
      properties: { ...posts.properties, author: { $ref: "silo://collections/authors" } },
    });
    await service.entries.create(scope, "posts", { title: "first", author: {} });

    const collection = await service.collections.get(scope, "authors");
    await service.collections.rename(scope, collection.id, "authors", "writers");

    expect((await service.collections.get(scope, "posts")).schema).toMatchObject({
      properties: { author: { $ref: "silo://collections/writers" } },
    });
  });

  test("creating a collection is never frozen by another one's entries", async () => {
    await service.entries.create(scope, "posts", { title: "first" });
    expect((await putSchema({ type: "object" }, "notes")).status).toBe(404);

    const created = await app.request("/api/projects/acme/environments/prod/collections", {
      method: "POST",
      headers: { Authorization: `Bearer ${rootKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "notes", schema: { type: "object" } }),
    });
    expect(created.status).toBe(201);
  });
});
