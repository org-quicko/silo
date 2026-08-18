import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../adapters/storage/sqlite/sqlite-store";
import { Service } from "../../core/service/service";
import { Scope } from "../../core/domain/scope";
import { MediaResolver } from "../../core/media/media-resolver";
import { SiloServer } from "../../http/server";

describe("Schema Media Field & Fully Qualified URL API Responses", () => {
  let tempDir: string;
  let store: SqliteStore;
  let svc: Service;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-schema-media-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    svc = new Service(store, { mediaDir: path.join(tempDir, "media") });
    app = new SiloServer(svc, "test", true).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("MediaResolver unit helper methods", () => {
    const mediaProp = { type: "string", "x-silo-type": "media" };
    const stringProp = { type: "string" };

    expect(MediaResolver.isMediaField(mediaProp)).toBe(true);
    expect(MediaResolver.isMediaField(stringProp)).toBe(false);

    const baseUrl = "http://localhost:8090";
    expect(MediaResolver.toAbsoluteUrl("/media/hash_file.png", baseUrl)).toBe("http://localhost:8090/media/hash_file.png");
    expect(MediaResolver.toAbsoluteUrl("hash_file.png", baseUrl)).toBe("http://localhost:8090/media/hash_file.png");
    expect(MediaResolver.toAbsoluteUrl("http://cdn.com/media/hash_file.png", baseUrl)).toBe("http://cdn.com/media/hash_file.png");

    expect(MediaResolver.toRelativePath("http://localhost:8090/media/hash_file.png")).toBe("/media/hash_file.png");
    expect(MediaResolver.toRelativePath("/media/hash_file.png")).toBe("/media/hash_file.png");
    expect(MediaResolver.toRelativePath("hash_file.png")).toBe("/media/hash_file.png");
  });

  test("Schema with flat, nested, and array media fields transforms API responses", async () => {
    const postSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        title: { type: "string" },
        cover_image: { type: "string", "x-silo-type": "media" },
        author: {
          type: "object",
          properties: {
            name: { type: "string" },
            avatar: { type: "string", "x-silo-type": "media" },
          },
        },
        gallery: {
          type: "array",
          items: { type: "string", "x-silo-type": "media" },
        },
      },
    };

    // 1. Put collection schema
    await svc.putSchema(Scope.Default, "posts", postSchema);

    // 2. Create entry via HTTP API sending relative or full URLs
    const postRes = await app.request("http://localhost:8090/api/projects/default/environments/prod/collections/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "First Post",
        cover_image: "http://localhost:8090/media/111_cover.png",
        author: {
          name: "Alice",
          avatar: "/media/222_avatar.png",
        },
        gallery: ["/media/333_pic1.png", "444_pic2.png"],
      }),
    });

    expect(postRes.status).toBe(201);
    const createdData = await postRes.json() as any;

    // Check that API response returns fully qualified URLs as flat strings
    expect(createdData.cover_image).toBe("http://localhost:8090/media/111_cover.png");
    expect(createdData.author.avatar).toBe("http://localhost:8090/media/222_avatar.png");
    expect(createdData.gallery).toEqual([
      "http://localhost:8090/media/333_pic1.png",
      "http://localhost:8090/media/444_pic2.png",
    ]);

    // 3. Verify on-disk / raw database stored data remains relative for portability
    const entryInStore = await svc.getEntry(Scope.Default, "posts", createdData.id);
    expect(entryInStore.data.cover_image).toBe("/media/111_cover.png");
    expect(entryInStore.data.author.avatar).toBe("/media/222_avatar.png");
    expect(entryInStore.data.gallery).toEqual(["/media/333_pic1.png", "/media/444_pic2.png"]);

    // 4. Fetch entry via GET API and verify fully qualified URLs
    const getRes = await app.request(`http://my-domain.com:9000/api/projects/default/environments/prod/collections/posts/${createdData.id}`);
    expect(getRes.status).toBe(200);
    const fetchedData = await getRes.json() as any;

    // Requesting on a different domain should reflect that domain's base URL!
    expect(fetchedData.cover_image).toBe("http://my-domain.com:9000/media/111_cover.png");
    expect(fetchedData.author.avatar).toBe("http://my-domain.com:9000/media/222_avatar.png");
    expect(fetchedData.gallery).toEqual([
      "http://my-domain.com:9000/media/333_pic1.png",
      "http://my-domain.com:9000/media/444_pic2.png",
    ]);
  });
});
