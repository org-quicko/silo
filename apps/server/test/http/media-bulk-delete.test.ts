import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { MediaRef } from "@silo/shared/media-ref";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * `POST /api/media/delete` (D48/Part 2): the bulk sibling of `DELETE
 * /api/media/{id}`, sharing `MediaDeletionService.delete` per id rather than
 * one lock over the whole batch.
 */
describe("bulk media delete (D48)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-bulk-delete-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    app = new SiloServer(service, { version: "test", authDisabled: true, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const seedCollection = async () => {
    await service.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });
  };

  const post = (body: unknown) =>
    app.request("/api/media/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  test("answers 200 with a mixed body: deleted, media_in_use with referrers, and not_found", async () => {
    await seedCollection();
    const free = await service.media.save("free.png", new TextEncoder().encode("a"));
    const used = await service.media.save("used.png", new TextEncoder().encode("b"));
    const entry = await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(used.id) });

    const response = await post({ ids: [free.id, used.id, "does-not-exist"], force: false });
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.deleted).toEqual([free.id]);
    expect(body.failed).toHaveLength(2);

    const inUse = body.failed.find((failure: any) => failure.id === used.id);
    expect(inUse.code).toBe("media_in_use");
    expect(inUse.usage_count).toBe(1);
    expect(inUse.visible_count).toBe(1);
    expect(inUse.referrers).toHaveLength(1);
    expect(inUse.referrers[0].entry_id).toBe(entry.id);
    expect(inUse.referrers[0].collection).toBe("posts");

    const notFound = body.failed.find((failure: any) => failure.id === "does-not-exist");
    expect(notFound.code).toBe("not_found");

    // The deleted id is gone; the in-use one is untouched.
    await expect(service.media.get(free.id)).rejects.toThrow();
    expect((await service.media.get(used.id)).state).toBe("active");
  });

  test("force: true deletes only the ids it is given, over a live reference", async () => {
    await seedCollection();
    const used = await service.media.save("used.png", new TextEncoder().encode("bytes"));
    const other = await service.media.save("other.png", new TextEncoder().encode("bytes"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(used.id) });

    const response = await post({ ids: [used.id], force: true });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.deleted).toEqual([used.id]);
    expect(body.failed).toEqual([]);

    await expect(service.media.get(used.id)).rejects.toThrow();
    // Untouched: force only applies to the ids named in the request.
    expect((await service.media.get(other.id)).state).toBe("active");
  });

  test("a second pass does not retry ids the first pass already deleted", async () => {
    await seedCollection();
    const free = await service.media.save("free.png", new TextEncoder().encode("a"));
    const used = await service.media.save("used.png", new TextEncoder().encode("b"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(used.id) });

    const first = (await (await post({ ids: [free.id, used.id], force: false })).json()) as any;
    expect(first.deleted).toEqual([free.id]);

    // Only the still-in-use id is retried, forced.
    const second = (await (await post({ ids: [used.id], force: true })).json()) as any;
    expect(second.deleted).toEqual([used.id]);
    expect(second.failed).toEqual([]);
  });

  test("caps ids at 100 per request", async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `id-${index}`);
    const response = await post({ ids });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.message).toContain("100");
  });

  test("rejects an empty or malformed ids array", async () => {
    expect((await post({ ids: [] })).status).toBe(400);
    expect((await post({ ids: "not-an-array" })).status).toBe(400);
    expect((await post({ ids: [""] })).status).toBe(400);
    expect((await post({ ids: [123] })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  test("a malformed id mid-batch is a per-id invalid_id failure, not a 400 that discards the rest of the report", async () => {
    const free = await service.media.save("free.png", new TextEncoder().encode("a"));

    const response = await post({ ids: [free.id, "../x"] });
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.deleted).toEqual([free.id]);
    expect(body.failed).toEqual([
      expect.objectContaining({ id: "../x", code: "invalid_id" }),
    ]);
    // The earlier, valid id was deleted despite the later one being malformed.
    await expect(service.media.get(free.id)).rejects.toThrow();
  });

  test("duplicate ids are deduped, not reported as a spurious not_found for the id the batch's own first pass removed", async () => {
    const asset = await service.media.save("dup.png", new TextEncoder().encode("a"));

    const response = await post({ ids: [asset.id, asset.id] });
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.deleted).toEqual([asset.id]);
    expect(body.failed).toEqual([]);
  });

  test("media_delete_stalled is mapped, not swallowed into a generic failure", async () => {
    const asset = await service.media.save("stuck.png", new TextEncoder().encode("bytes"));
    service.blobStorage.delete = async () => {
      throw new Error("AccessDenied");
    };

    const response = await post({ ids: [asset.id] });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.deleted).toEqual([]);
    expect(body.failed).toEqual([
      expect.objectContaining({ id: asset.id, code: "media_delete_stalled" }),
    ]);
  });

  test("?force=true on the single-delete route also skips the usage check (D48)", async () => {
    await seedCollection();
    const asset = await service.media.save("single.png", new TextEncoder().encode("bytes"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    const refused = await app.request(`/api/media/${asset.id}`, { method: "DELETE" });
    expect(refused.status).toBe(409);

    // Only the literal string "true" enables it.
    const ignored = await app.request(`/api/media/${asset.id}?force=yes`, { method: "DELETE" });
    expect(ignored.status).toBe(409);

    const forced = await app.request(`/api/media/${asset.id}?force=true`, { method: "DELETE" });
    expect(forced.status).toBe(204);
    await expect(service.media.get(asset.id)).rejects.toThrow();
  });
});

/**
 * `POST /api/media/delete` with auth enabled (D48/Part 2).
 *
 * The sibling suite above builds its server `authDisabled: true`, so it has
 * never exercised the route's `media:delete` requirement, nor — the more
 * load-bearing gap — the claim-filtered referrer enumeration a `media_in_use`
 * failure carries. The design argument that force needs no new claim rests on
 * that filtering already governing what a key can see, so it has to be
 * asserted rather than merely correct by construction (§8.1).
 */
describe("bulk media delete authorization (D48)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-bulk-delete-auth-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.keys.bootstrap();
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const mint = async (claims: string[]) => (await service.keys.create("probe", claims)).secret;
  const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

  const post = (body: unknown, key: string) =>
    app.request("/api/media/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(key) },
      body: JSON.stringify(body),
    });

  test("a key without media:delete is refused", async () => {
    const asset = await service.media.save("free.png", new TextEncoder().encode("bytes"));
    const key = await mint([Claims.MediaRead]);

    const response = await post({ ids: [asset.id] }, key);
    expect(response.status).toBe(403);
  });

  test("media_in_use reports the true usage_count but only referring scopes the key may read, for every id in the batch", async () => {
    // Two scopes, the same shape media.test.ts uses for its own
    // claim-filtering assertion — "default" the key can read, "other" it
    // cannot.
    await service.scopes.createProject("other");
    await service.scopes.createEnvironment("other", "prod");
    const otherScope = Scope.of("other", "prod");

    for (const scope of [Scope.Default, otherScope]) {
      await service.collections.putSchema(scope, "posts", {
        type: "object",
        properties: { cover: { type: "string", "x-silo-type": "media" } },
      });
    }

    const a = await service.media.save("a.png", new TextEncoder().encode("a"));
    const b = await service.media.save("b.png", new TextEncoder().encode("b"));
    for (const asset of [a, b]) {
      await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });
      await service.entries.create(otherScope, "posts", { cover: MediaRef.url(asset.id) });
    }

    // media:delete plus entries:read on "default" only — not "other".
    const key = await mint([
      Claims.MediaDelete,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
    ]);

    const response = await post({ ids: [a.id, b.id], force: false }, key);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.deleted).toEqual([]);
    expect(body.failed).toHaveLength(2);

    // Every entry in the batch, not just the first: each carries the true
    // total (2, both scopes) and a filtered referrer list naming only the
    // scope this key can read.
    for (const failure of body.failed) {
      expect(failure.code).toBe("media_in_use");
      expect(failure.usage_count).toBe(2);
      expect(failure.visible_count).toBe(1);
      expect(failure.referrers).toHaveLength(1);
      expect(failure.referrers[0].project).toBe("default");
    }
  });
});
