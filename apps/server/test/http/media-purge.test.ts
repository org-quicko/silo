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

/** `POST /api/media/purge` (D49): empties the whole library, paging through
 *  the catalog rather than loading it all, and answers the same
 *  `{deleted, failed}` shape bulk delete does, plus a folder count. */
describe("media purge (D49)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-purge-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    app = new SiloServer(service, { version: "test", authDisabled: true, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const purge = (body: unknown) =>
    app.request("/api/media/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const seedCollection = async () => {
    await service.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });
  };

  test("requires the literal confirm word", async () => {
    await service.media.save("a.png", new TextEncoder().encode("a"));
    expect((await purge({})).status).toBe(400);
    expect((await purge({ confirm: "yes" })).status).toBe(400);
    expect((await purge({ confirm: "PURGE" })).status).toBe(400);
    expect(await service.media.list()).toMatchObject({ total: 1 });
  });

  test("unforced: deletes every free asset, reports referenced ones, and answers a partial-purge body", async () => {
    await seedCollection();
    const free1 = await service.media.save("free1.png", new TextEncoder().encode("a"));
    const free2 = await service.media.save("free2.png", new TextEncoder().encode("b"));
    const used = await service.media.save("used.png", new TextEncoder().encode("c"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(used.id) });
    await service.media.createFolder("/empty");

    const response = await purge({ confirm: "purge" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    expect([...body.deleted].sort()).toEqual([free1.id, free2.id].sort());
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].id).toBe(used.id);
    expect(body.failed[0].code).toBe("media_in_use");
    // Something is still referenced, so the library is not actually empty —
    // no folder record is removed.
    expect(body.folders_deleted).toBe(0);

    expect(await service.media.listFolders()).toContain("/empty");
    await expect(service.media.get(used.id)).resolves.toBeTruthy();
  });

  test("forced: everything goes, folder records included", async () => {
    await seedCollection();
    const a = await service.media.save("a.png", new TextEncoder().encode("a"));
    const used = await service.media.save("used.png", new TextEncoder().encode("b"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(used.id) });
    await service.media.createFolder("/empty");

    const response = await purge({ confirm: "purge", force: true });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    expect([...body.deleted].sort()).toEqual([a.id, used.id].sort());
    expect(body.failed).toEqual([]);
    expect(body.folders_deleted).toBe(1);
    expect(await service.media.listFolders()).toEqual([]);
    expect(await service.media.list()).toMatchObject({ total: 0 });
  });

  test("pages through more assets than one batch holds", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 210; index++) {
      const asset = await service.media.save(`f${index}.png`, new TextEncoder().encode(String(index)));
      ids.push(asset.id);
    }

    const response = await purge({ confirm: "purge" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.deleted).toHaveLength(210);
    expect([...body.deleted].sort()).toEqual([...ids].sort());
    expect(await service.media.list()).toMatchObject({ total: 0 });
  }, 30000);

  test("interleaved paging: in-use assets scattered across page boundaries all survive, every free asset is deleted", async () => {
    await seedCollection();
    const free: string[] = [];
    const used: string[] = [];
    // 220 assets, more than one 200-item batch — every 7th one is referenced,
    // scattering "stays" failures across both the first page (indices 0-199)
    // and the second (200-219), which is exactly the offset arithmetic the
    // failure-count paging exists to get right.
    for (let index = 0; index < 220; index++) {
      const asset = await service.media.save(`f${index}.png`, new TextEncoder().encode(String(index)));
      if (index % 7 === 0) {
        await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });
        used.push(asset.id);
      } else {
        free.push(asset.id);
      }
    }

    const response = await purge({ confirm: "purge" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    expect([...body.deleted].sort()).toEqual([...free].sort());
    expect(body.failed.map((failure: any) => failure.id).sort()).toEqual([...used].sort());
    expect(body.failed.every((failure: any) => failure.code === "media_in_use")).toBe(true);
    // Something is still referenced, so no folder record is removed.
    expect(body.folders_deleted).toBe(0);

    for (const id of used) {
      await expect(service.media.get(id)).resolves.toBeTruthy();
    }
    expect(await service.media.list()).toMatchObject({ total: used.length });
  }, 30000);

  test("force is checked once over the whole catalog before any delete runs — a refusal past the first page leaves every asset intact", async () => {
    await service.keys.bootstrap();
    const authedApp = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();
    await seedCollection();

    // 300 assets, the first 200 unreferenced; asset #250 — past the first
    // 200-item batch — is referenced from a scope the key lacks
    // entries:update in. A per-page check would have already deleted the
    // first 200 (and their blobs) before ever reaching the page that refuses.
    const ids: string[] = [];
    for (let index = 0; index < 300; index++) {
      const asset = await service.media.save(`f${index}.png`, new TextEncoder().encode(String(index)));
      ids.push(asset.id);
    }
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(ids[250]) });

    const key = (await service.keys.create("probe", [Claims.MediaDelete])).secret;
    const response = await authedApp.request("/api/media/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ confirm: "purge", force: true }),
    });
    expect(response.status).toBe(403);

    // Nothing was deleted: the pre-flight check ran over every id before the
    // first page's delete, not per page after it had already run.
    expect(await service.media.list()).toMatchObject({ total: 300 });
    await expect(service.media.get(ids[0])).resolves.toBeTruthy();
    await expect(service.media.get(ids[199])).resolves.toBeTruthy();
    await expect(service.media.get(ids[250])).resolves.toBeTruthy();
    await expect(service.media.get(ids[299])).resolves.toBeTruthy();
  }, 30000);

  test("force on purge requires the D49 authority check", async () => {
    await service.keys.bootstrap();
    const authedApp = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();
    await seedCollection();
    const used = await service.media.save("used.png", new TextEncoder().encode("b"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(used.id) });

    const key = (await service.keys.create("probe", [Claims.MediaDelete])).secret;
    const response = await authedApp.request("/api/media/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ confirm: "purge", force: true }),
    });
    expect(response.status).toBe(403);
    expect((await service.media.get(used.id)).state).toBe("active");
  });

  test("requires media:delete", async () => {
    await service.keys.bootstrap();
    const authedApp = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();
    const key = (await service.keys.create("probe", [Claims.MediaRead])).secret;

    const response = await authedApp.request("/api/media/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ confirm: "purge" }),
    });
    expect(response.status).toBe(403);
  });
});
