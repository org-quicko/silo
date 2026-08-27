import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { MediaResolver } from "../../src/core/media/media-resolver";
import { MediaRefs } from "../../src/core/media/media-refs";
import { MediaRef } from "@silo/shared/media-ref";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

describe("Media references in entry data (D23)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-schema-media-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    app = new SiloServer(service, { version: "test", authDisabled: true, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("MediaResolver resolves catalog ids, legacy paths, and foreign URLs", () => {
    expect(MediaResolver.isMediaField({ type: "string", "x-silo-type": "media" })).toBe(true);
    expect(MediaResolver.isMediaField({ type: "string" })).toBe(false);

    const baseUrl = "http://localhost:8090";
    const id = "01J8XQ4Z8K9M2P3R5T7V9X1B3D";

    // The canonical form since D23: addressed by catalog id, so the URL
    // survives a rename or a move.
    expect(MediaResolver.toAbsoluteUrl(MediaRef.url(id), baseUrl)).toBe(`${baseUrl}/media/${id}`);
    // Pre-D23 entries still resolve while an instance is being backfilled.
    expect(MediaResolver.toAbsoluteUrl("/media/hash_file.png", baseUrl)).toBe(
      `${baseUrl}/media/hash_file.png`
    );
    // A foreign URL is somebody else's asset and is left alone.
    expect(MediaResolver.toAbsoluteUrl("http://cdn.com/media/hash_file.png", baseUrl)).toBe(
      "http://cdn.com/media/hash_file.png"
    );
    // A bare string is no longer guessed at as a media key.
    expect(MediaResolver.toAbsoluteUrl("hash_file.png", baseUrl)).toBe("hash_file.png");
  });

  test("extraction is structural — it finds references the schema never mentions", () => {
    const id = "01J8XQ4Z8K9M2P3R5T7V9X1B3D";
    const other = "01J8XQ50P1R2S3T4U5V6W7X8Y9";

    expect(
      MediaRefs.extract({
        cover: MediaRef.url(id),
        nested: { deep: [{ picked: MediaRef.url(other) }] },
        legacy: "/media/aabb_old.png",
        prose: "no reference here",
        count: 3,
      })
    ).toEqual([id, other, MediaRef.blobToken("aabb_old.png")].sort());

    // Same reference twice is one usage.
    expect(MediaRefs.extract({ a: MediaRef.url(id), b: MediaRef.url(id) })).toEqual([id]);
    expect(MediaRefs.extract(null)).toEqual([]);
  });

  test("API responses resolve media fields against the requesting host", async () => {
    await service.collections.putSchema(Scope.Default, "posts", {
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
        gallery: { type: "array", items: { type: "string", "x-silo-type": "media" } },
      },
    });

    // Legacy path form: entries written before D23 keep working, and are not
    // checked against the catalog (there is nothing to check them against).
    const postRes = await app.request(
      "http://localhost:8090/api/projects/default/environments/prod/collections/posts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "First Post",
          cover_image: "/media/111_cover.png",
          author: { name: "Alice", avatar: "/media/222_avatar.png" },
          gallery: ["/media/333_pic1.png"],
        }),
      }
    );
    expect(postRes.status).toBe(201);
    const created = (await postRes.json()) as any;

    expect(created.cover_image).toBe("http://localhost:8090/media/111_cover.png");
    expect(created.author.avatar).toBe("http://localhost:8090/media/222_avatar.png");
    expect(created.gallery).toEqual(["http://localhost:8090/media/333_pic1.png"]);

    // Stored exactly as sent — the write path no longer rewrites values.
    const stored = await service.entries.get(Scope.Default, "posts", created.id);
    expect(stored.data.cover_image).toBe("/media/111_cover.png");

    // A different host resolves against that host.
    const getRes = await app.request(
      `http://my-domain.com:9000/api/projects/default/environments/prod/collections/posts/${created.id}`
    );
    const fetched = (await getRes.json()) as any;
    expect(fetched.cover_image).toBe("http://my-domain.com:9000/media/111_cover.png");
    expect(fetched.gallery).toEqual(["http://my-domain.com:9000/media/333_pic1.png"]);
  });

  test("an entry cannot reference a catalog id that does not exist", async () => {
    await service.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });

    const response = await app.request(
      "http://localhost:8090/api/projects/default/environments/prod/collections/posts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cover: MediaRef.url("01J8XQ4Z8K9M2P3R5T7V9X1B3D") }),
      }
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("does not exist");
  });
});
