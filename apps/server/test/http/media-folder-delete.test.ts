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

/** `DELETE /api/media/folders` (D49): the non-recursive default is
 *  unchanged, and `?recursive=true` deletes everything inside a folder
 *  through the same per-id outcome machinery as `POST /api/media/delete`. */
describe("media folder delete (D49)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-folder-delete-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    app = new SiloServer(service, { version: "test", authDisabled: true, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const del = (query: string) => app.request(`/api/media/folders?${query}`, { method: "DELETE" });

  const seedCollection = async () => {
    await service.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });
  };

  test("without recursive, still refuses while the folder holds anything", async () => {
    await service.media.save("x.png", new TextEncoder().encode("x"), undefined, "/a");

    const response = await del(`path=${encodeURIComponent("/a")}`);
    expect(response.status).toBe(409);
    expect(await service.media.listFolders()).toContain("/a");
  });

  test("without recursive, an empty folder still deletes trivially", async () => {
    await service.media.createFolder("/a");
    const response = await del(`path=${encodeURIComponent("/a")}`);
    expect(response.status).toBe(204);
    expect(await service.media.listFolders()).not.toContain("/a");
  })

  test("force without recursive is rejected rather than silently discarded", async () => {
    // Without recursive, nothing in this request deletes anything, so there
    // is nothing for force to force — accepting the flag and dropping it
    // would be the worst handling available (D32).
    await service.media.createFolder("/a");
    const response = await del(`path=${encodeURIComponent("/a")}&force=true`);
    expect(response.status).toBe(400);
    expect(await service.media.listFolders()).toContain("/a");
  });

  test("recursive: a mix of free and referenced assets — unforced deletes what it can and reports the rest", async () => {
    await seedCollection();
    const free = await service.media.save("free.png", new TextEncoder().encode("a"), undefined, "/a");
    const used = await service.media.save("used.png", new TextEncoder().encode("b"), undefined, "/a/x");
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(used.id) });

    const response = await del(`path=${encodeURIComponent("/a")}&recursive=true`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.deleted).toEqual([free.id]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].code).toBe("media_in_use");
    // Something is still there, so the folder records must not vanish.
    expect(body.folders_deleted).toBe(0);
    expect(await service.media.listFolders()).toContain("/a");
    expect(await service.media.listFolders()).toContain("/a/x");
  });

  test("recursive + force: everything in the subtree goes, and so do the folder records", async () => {
    await seedCollection();
    // Explicit records, not just folders implied by an asset's path, so the
    // "folder records removed" half of the response has something to count.
    await service.media.createFolder("/a");
    await service.media.createFolder("/a/x");
    const free = await service.media.save("free.png", new TextEncoder().encode("a"), undefined, "/a");
    const used = await service.media.save("used.png", new TextEncoder().encode("b"), undefined, "/a/x");
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(used.id) });

    const response = await del(`path=${encodeURIComponent("/a")}&recursive=true&force=true`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect([...body.deleted].sort()).toEqual([free.id, used.id].sort());
    expect(body.failed).toEqual([]);
    expect(body.folders_deleted).toBe(2);

    const folders = await service.media.listFolders();
    expect(folders).not.toContain("/a");
    expect(folders).not.toContain("/a/x");
    await expect(service.media.get(free.id)).rejects.toThrow();
    await expect(service.media.get(used.id)).rejects.toThrow();
  });

  test("recursive delete on an empty folder deletes its record and reports nothing failed", async () => {
    await service.media.createFolder("/a");
    const response = await del(`path=${encodeURIComponent("/a")}&recursive=true`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ deleted: [], failed: [], folders_deleted: 1 });
  });

  test("force on the recursive route requires the D49 authority check", async () => {
    await service.keys.bootstrap();
    const authedApp = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();
    await seedCollection();
    const used = await service.media.save("used.png", new TextEncoder().encode("b"), undefined, "/a");
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(used.id) });

    const key = (await service.keys.create("probe", [Claims.MediaDelete])).secret;
    const response = await authedApp.request(
      `/api/media/folders?path=${encodeURIComponent("/a")}&recursive=true&force=true`,
      { method: "DELETE", headers: { Authorization: `Bearer ${key}` } },
    );
    expect(response.status).toBe(403);
    expect((await service.media.get(used.id)).state).toBe("active");
  });
});
