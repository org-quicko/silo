import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../adapters/storage/sqlite/sqlite-store";
import { Service } from "../../core/service/service";
import { Scope } from "../../core/domain/scope";

const authorSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" },
    email: { type: "string" },
  },
};

const postSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["title"],
  properties: {
    title: { type: "string" },
    author: { $ref: "silo://collections/authors" },
  },
};

const collectionWithArrayRefSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["title", "authors"],
  properties: {
    title: { type: "string" },
    authors: {
      type: "array",
      items: { $ref: "silo://collections/authors" },
    },
  },
};

describe("schema $refs", () => {
  let tempDir: string;
  let store: SqliteStore;

  const newService = (allowRemoteRefs = false) => new Service(store, { allowRemoteRefs });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-refs-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("local collection refs resolve and validate entries", async () => {
    const svc = newService();
    await svc.putSchema(Scope.Default, "authors", authorSchema);
    await svc.putSchema(Scope.Default, "posts", postSchema);

    const ok = await svc.createEntry(Scope.Default, "posts", {
      title: "Hello",
      author: { name: "Ada" },
    });
    expect(ok.id).toBeTruthy();

    // Violates the *referenced* authors schema (missing required "name").
    await expect(
      svc.createEntry(Scope.Default, "posts", { title: "Nope", author: { email: "x@y.z" } })
    ).rejects.toThrow(/name/);
  });

  test("ref to an unknown collection is rejected with a clear error", async () => {
    const svc = newService();
    await expect(svc.putSchema(Scope.Default, "posts", postSchema)).rejects.toThrow(
      /unknown collection "authors"/
    );
  });

  test("remote refs are rejected by default with an opt-in hint", async () => {
    const svc = newService();
    const schema = {
      type: "object",
      properties: { geo: { $ref: "https://example.com/geo.schema.json" } },
    };
    await expect(svc.putSchema(Scope.Default, "places", schema)).rejects.toThrow(/allow_remote_refs/);
  });

  test("remote refs resolve when allow_remote_refs is enabled", async () => {
    let fetches = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        fetches++;
        return Response.json({
          type: "object",
          required: ["lat", "lng"],
          properties: { lat: { type: "number" }, lng: { type: "number" } },
        });
      },
    });
    try {
      const svc = newService(true);
      const schema = {
        type: "object",
        properties: { geo: { $ref: `http://localhost:${server.port}/geo.schema.json` } },
      };
      await svc.putSchema(Scope.Default, "places", schema);

      await svc.createEntry(Scope.Default, "places", { geo: { lat: 1.5, lng: 2.5 } });
      await expect(
        svc.createEntry(Scope.Default, "places", { geo: { lat: "not a number", lng: 0 } })
      ).rejects.toThrow(/validation failed/);
      expect(fetches).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  });

  test("unreachable remote schema fails with a fetch error, not a crash", async () => {
    const svc = newService(true);
    const schema = {
      type: "object",
      properties: { geo: { $ref: "http://127.0.0.1:1/nothing.json" } },
    };
    await expect(svc.putSchema(Scope.Default, "places", schema)).rejects.toThrow(/fetching remote schema/);
  });

  test("deleting a collection referenced by another schema requires force", async () => {
    const svc = newService();
    await svc.putSchema(Scope.Default, "authors", authorSchema);
    await svc.putSchema(Scope.Default, "posts", postSchema);

    await expect(svc.deleteCollection(Scope.Default, "authors", false)).rejects.toThrow(
      /referenced by schema "posts"/
    );

    await svc.deleteCollection(Scope.Default, "authors", true);
    await expect(svc.getCollection(Scope.Default, "authors")).rejects.toThrow();
  });

  test("schema references are automatically bundled into $defs", async () => {
    const svc = newService();
    await svc.putSchema(Scope.Default, "authors", authorSchema);
    const col = await svc.putSchema(Scope.Default, "posts", postSchema);

    // Original property $ref should be maintained
    expect(col.schema.properties.author.$ref).toBe("silo://collections/authors");

    // $defs should contain local copy of authors
    expect(col.schema.$defs).toBeTruthy();
    expect(col.schema.$defs.authors).toBeTruthy();
    expect(col.schema.$defs.authors.required).toEqual(["name"]);
  });

  test("remote schema references are bundled into $defs when allow_remote_refs is enabled", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          type: "object",
          required: ["lat", "lng"],
          properties: { lat: { type: "number" }, lng: { type: "number" } },
        });
      },
    });
    try {
      const svc = newService(true);
      const remoteUrl = `http://localhost:${server.port}/geo.schema.json`;
      const schema = {
        type: "object",
        properties: { geo: { $ref: remoteUrl } },
      };
      const col = await svc.putSchema(Scope.Default, "places", schema);

      expect(col.schema.properties.geo.$ref).toBe(remoteUrl);
      expect(col.schema.$defs).toBeTruthy();
      expect(col.schema.$defs[remoteUrl]).toBeTruthy();
      expect(col.schema.$defs[remoteUrl].required).toEqual(["lat", "lng"]);
    } finally {
      server.stop(true);
    }
  });

  test("arrays of local collection refs validate each item against the referenced schema", async () => {
    const svc = newService();
    await svc.putSchema(Scope.Default, "authors", authorSchema);
    await svc.putSchema(Scope.Default, "posts", collectionWithArrayRefSchema);

    const ok = await svc.createEntry(Scope.Default, "posts", {
      title: "Co-authored",
      authors: [{ name: "Ada" }, { name: "Bob" }],
    });
    expect(ok.id).toBeTruthy();

    // One item violates the referenced authors schema (missing required "name").
    await expect(
      svc.createEntry(Scope.Default, "posts", {
        title: "Bad",
        authors: [{ name: "Ada" }, { email: "x@y.z" }],
      })
    ).rejects.toThrow(/name/);
  });

  test("arrays of local collection refs are bundled into $defs and the items $ref is preserved", async () => {
    const svc = newService();
    await svc.putSchema(Scope.Default, "authors", authorSchema);
    const col = await svc.putSchema(Scope.Default, "posts", collectionWithArrayRefSchema);

    // The original items.$ref should be maintained.
    expect(col.schema.properties.authors.type).toBe("array");
    expect(col.schema.properties.authors.items.$ref).toBe("silo://collections/authors");

    // $defs should contain a local copy of authors.
    expect(col.schema.$defs).toBeTruthy();
    expect(col.schema.$defs.authors).toBeTruthy();
    expect(col.schema.$defs.authors.required).toEqual(["name"]);
  });

  test("deleting a collection referenced from an array items $ref requires force", async () => {
    const svc = newService();
    await svc.putSchema(Scope.Default, "authors", authorSchema);
    await svc.putSchema(Scope.Default, "posts", collectionWithArrayRefSchema);

    await expect(svc.deleteCollection(Scope.Default, "authors", false)).rejects.toThrow(
      /referenced by schema "posts"/
    );

    await svc.deleteCollection(Scope.Default, "authors", true);
    await expect(svc.getCollection(Scope.Default, "authors")).rejects.toThrow();
  });
});
