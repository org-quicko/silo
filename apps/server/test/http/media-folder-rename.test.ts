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

/** `PATCH /api/media/folders` (D49): rename or move a folder, its
 *  descendant folders, and every asset within — no entry touched, no blob
 *  moved. */
describe("media folder rename (D49)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-folder-rename-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    app = new SiloServer(service, { version: "test", authDisabled: true, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const patch = (body: unknown) =>
    app.request("/api/media/folders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  /** Every explicit `_media_folders` record's path, duplicates included —
   *  `listFolders` dedupes through a `Set`, so it cannot see two records
   *  naming one folder. */
  const folderRecordPaths = async (): Promise<string[]> => {
    const { items } = await store.list(Scope.System, "_media_folders", { limit: 1000, offset: 0 });
    return items.map((entry) => (entry.data as { path: string }).path).sort();
  };

  test("moves every asset and descendant folder, touching no entry", async () => {
    await service.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });
    const inRoot = await service.media.save("hero.png", new TextEncoder().encode("a"), undefined, "/a");
    const nested = await service.media.save("logo.png", new TextEncoder().encode("b"), undefined, "/a/x");
    await service.media.createFolder("/a/empty");
    const entry = await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(inRoot.id) });

    const response = await patch({ from: "/a", to: "/b" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ from: "/a", to: "/b" });

    expect((await service.media.get(inRoot.id)).folder).toBe("/b");
    expect((await service.media.get(nested.id)).folder).toBe("/b/x");

    const folders = await service.media.listFolders();
    expect(folders).toContain("/b");
    expect(folders).toContain("/b/x");
    expect(folders).toContain("/b/empty");
    expect(folders).not.toContain("/a");
    expect(folders).not.toContain("/a/x");
    expect(folders).not.toContain("/a/empty");

    // No entry was touched: same rev, same reference.
    const after = await service.entries.get(Scope.Default, "posts", entry.id);
    expect(after.rev).toBe(entry.rev);
    expect(after.data.cover).toBe(MediaRef.url(inRoot.id));
    // No blob moved: the same key still serves the same bytes.
    expect((await service.media.get(inRoot.id)).blob_key).toBe(inRoot.blob_key);
  });

  test("a prefix sibling is not a descendant: /a to /c leaves /ab alone, and /ab to /c leaves /a alone", async () => {
    const inA = await service.media.save("a.png", new TextEncoder().encode("a"), undefined, "/a");
    const inAb = await service.media.save("ab.png", new TextEncoder().encode("b"), undefined, "/ab");

    expect((await patch({ from: "/a", to: "/c" })).status).toBe(200);
    expect((await service.media.get(inA.id)).folder).toBe("/c");
    expect((await service.media.get(inAb.id)).folder).toBe("/ab");

    expect((await patch({ from: "/ab", to: "/d" })).status).toBe(200);
    expect((await service.media.get(inAb.id)).folder).toBe("/d");
    expect((await service.media.get(inA.id)).folder).toBe("/c");
  });

  test("refuses a move that would push a descendant past the depth ceiling", async () => {
    // /a plus 15 levels under it is exactly MaxDepth; moving /a one level
    // deeper would store a 17-segment path no upload could create.
    await service.media.createFolder("/a/" + Array.from({ length: 15 }, (_, i) => `s${i}`).join("/"));

    const response = await patch({ from: "/a", to: "/parent/a" });
    expect(response.status).toBe(400);
    // Refused before anything was written: the subtree is untouched.
    expect(await service.media.listFolders()).toContain("/a");
  });

  test("refuses when the destination already exists, as an explicit record", async () => {
    await service.media.createFolder("/a");
    await service.media.createFolder("/b");

    const response = await patch({ from: "/a", to: "/b" });
    expect(response.status).toBe(409);
  });

  test("refuses when the destination already exists, implied by an asset's folder", async () => {
    await service.media.createFolder("/a");
    await service.media.save("x.png", new TextEncoder().encode("x"), undefined, "/b");

    const response = await patch({ from: "/a", to: "/b" });
    expect(response.status).toBe(409);
  });

  test("refuses moving a folder into its own descendant", async () => {
    await service.media.createFolder("/a");
    await service.media.createFolder("/a/b");

    const response = await patch({ from: "/a", to: "/a/b/c" });
    expect(response.status).toBe(400);
  });

  test("refuses moving a folder into itself", async () => {
    await service.media.createFolder("/a");
    const response = await patch({ from: "/a", to: "/a" });
    expect(response.status).toBe(400);
  });

  test("refuses when the source does not exist", async () => {
    const response = await patch({ from: "/nope", to: "/elsewhere" });
    expect(response.status).toBe(404);
  });

  test("merge moves a subtree into an existing folder, descendant folders and assets included", async () => {
    const inA = await service.media.save("hero.png", new TextEncoder().encode("a"), undefined, "/a");
    const nested = await service.media.save("logo.png", new TextEncoder().encode("b"), undefined, "/a/x");
    await service.media.createFolder("/a/empty");
    const already = await service.media.save("existing.png", new TextEncoder().encode("c"), undefined, "/b");

    const response = await patch({ from: "/a", to: "/b", merge: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ from: "/a", to: "/b" });

    expect((await service.media.get(inA.id)).folder).toBe("/b");
    expect((await service.media.get(nested.id)).folder).toBe("/b/x");
    expect((await service.media.get(already.id)).folder).toBe("/b");

    const folders = await service.media.listFolders();
    expect(folders).toContain("/b");
    expect(folders).toContain("/b/x");
    expect(folders).toContain("/b/empty");
    expect(folders).not.toContain("/a");
    expect(folders).not.toContain("/a/x");
    expect(folders).not.toContain("/a/empty");
  });

  test("merge leaves one folder record per path, however many times it is run (D49 audit fix)", async () => {
    await service.media.createFolder("/a/x");
    await service.media.createFolder("/b/x");
    expect(await folderRecordPaths()).toEqual(["/a/x", "/b/x"]);

    expect((await patch({ from: "/a", to: "/b", merge: true })).status).toBe(200);
    // Not ["/b/x", "/b/x"]: putting a record for a path that already has one
    // would leave two records naming one folder, and `listFolders` dedupes
    // through a `Set`, so nothing downstream would ever show it.
    expect(await folderRecordPaths()).toEqual(["/b/x"]);

    // A retry — what an interrupted rename leaves an operator doing — must
    // not accumulate a third.
    await service.media.createFolder("/a/x");
    expect((await patch({ from: "/a", to: "/b", merge: true })).status).toBe(200);
    expect(await folderRecordPaths()).toEqual(["/b/x"]);
  });

  test("merge with colliding filenames succeeds: both assets survive with distinct ids", async () => {
    const fromAsset = await service.media.save("logo.svg", new TextEncoder().encode("a"), undefined, "/a");
    const toAsset = await service.media.save("logo.svg", new TextEncoder().encode("b"), undefined, "/b");

    const response = await patch({ from: "/a", to: "/b", merge: true });
    expect(response.status).toBe(200);

    const moved = await service.media.get(fromAsset.id);
    const stayed = await service.media.get(toAsset.id);
    expect(moved.folder).toBe("/b");
    expect(stayed.folder).toBe("/b");
    expect(moved.filename).toBe("logo.svg");
    expect(stayed.filename).toBe("logo.svg");
    expect(moved.id).not.toBe(stayed.id);

    const page = await service.media.list({ folder: "/b" });
    expect(page.items.map((item) => item.id).sort()).toEqual([fromAsset.id, toAsset.id].sort());
  });

  test("merge completes an interrupted rename: assets already split across /a and /b consolidate", async () => {
    // Simulates what a crash mid-rename leaves behind (D49): some assets
    // already at `to`, some still at `from` — both exist per D20's rule, and
    // a plain rename refuses on the resulting collision.
    const stillAtFrom = await service.media.save("a.png", new TextEncoder().encode("a"), undefined, "/a");
    const alreadyAtTo = await service.media.save("b.png", new TextEncoder().encode("b"), undefined, "/b");

    const collision = await patch({ from: "/a", to: "/b" });
    expect(collision.status).toBe(409);

    const response = await patch({ from: "/a", to: "/b", merge: true });
    expect(response.status).toBe(200);

    expect((await service.media.get(stillAtFrom.id)).folder).toBe("/b");
    expect((await service.media.get(alreadyAtTo.id)).folder).toBe("/b");
    expect(await service.media.listFolders()).not.toContain("/a");
  });

  test("merge still refuses moving a folder into its own descendant", async () => {
    await service.media.createFolder("/a");
    await service.media.createFolder("/a/b");

    const response = await patch({ from: "/a", to: "/a/b/c", merge: true });
    expect(response.status).toBe(400);
  });

  test("merge still 404s when the source does not exist", async () => {
    await service.media.createFolder("/b");
    const response = await patch({ from: "/nope", to: "/b", merge: true });
    expect(response.status).toBe(404);
  });

  test("merge still refuses a root destination", async () => {
    await service.media.createFolder("/a");

    const response = await patch({ from: "/a", to: "/", merge: true });
    expect(response.status).toBe(400);
  });

  test("merge still refuses a move that would push a descendant past the depth ceiling", async () => {
    await service.media.createFolder("/a/" + Array.from({ length: 15 }, (_, i) => `s${i}`).join("/"));

    const response = await patch({ from: "/a", to: "/parent/a", merge: true });
    expect(response.status).toBe(400);
    expect(await service.media.listFolders()).toContain("/a");
  });

  test("requires media:create", async () => {
    await service.keys.bootstrap();
    const authedApp = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();
    await service.media.createFolder("/a");
    const key = (await service.keys.create("probe", [Claims.MediaRead])).secret;

    const response = await authedApp.request("/api/media/folders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: "/a", to: "/b" }),
    });
    expect(response.status).toBe(403);
  });
});

/**
 * The rename saga (D49): a rename spans more records than any adapter can
 * write atomically, so it is staged in `_media_folder_moves` and finished at
 * the next start.
 */
describe("media folder rename saga (D49)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-move-saga-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const bytes = () => new TextEncoder().encode("x");

  const markers = async (): Promise<Array<{ from: string; to: string }>> => {
    const { items } = await store.list(Scope.System, "_media_folder_moves", {
      limit: 100,
      offset: 0,
    });
    return items.map((entry) => entry.data as { from: string; to: string });
  };

  /** Stages a move marker the way a crashed rename leaves one, through the
   *  store rather than the service, so the test drives the recovery path
   *  without reaching into a private. */
  const stageMarker = async (from: string, to: string, id = "marker"): Promise<void> => {
    const now = new Date();
    await store.put(
      {
        id,
        project: Scope.System.project,
        env: Scope.System.env,
        collection: "_media_folder_moves",
        rev: 1,
        seq: 0,
        created_at: now,
        updated_at: now,
        data: { from, to },
      },
      { usages: [], search: null },
    );
  };

  /** Puts one asset's `folder` back, which is what a rename that died partway
   *  through the subtree leaves behind. */
  const strandAt = async (id: string, folder: string): Promise<void> => {
    const entry = await store.get(Scope.System, "_media", id);
    await store.put(
      { ...entry, data: { ...(entry.data as Record<string, unknown>), folder } },
      { usages: [], search: null },
    );
  };

  test("a completed rename leaves no marker behind", async () => {
    await service.media.save("a.png", bytes(), undefined, "/a");
    await service.media.renameFolder("/a", "/b");

    expect(await markers()).toEqual([]);
  });

  test("resume finishes a rename interrupted partway through the subtree", async () => {
    const moved = await service.media.save("moved.png", bytes(), undefined, "/a");
    const stranded = await service.media.save("stranded.png", bytes(), undefined, "/a/deep");

    await service.media.renameFolder("/a", "/b");
    // Exactly what a crash between two asset writes leaves: the subtree split
    // across both paths, with the marker still standing.
    await strandAt(stranded.id, "/a/deep");
    await stageMarker("/a", "/b");
    expect((await service.media.get(stranded.id)).folder).toBe("/a/deep");

    const result = await service.media.resumePendingFolderMoves();

    expect(result).toEqual({ finished: 1, pending: 0 });
    expect((await service.media.get(stranded.id)).folder).toBe("/b/deep");
    expect((await service.media.get(moved.id)).folder).toBe("/b");
    expect(await markers()).toEqual([]);
  });

  test("resume is idempotent when the move already completed", async () => {
    const asset = await service.media.save("a.png", bytes(), undefined, "/a");
    await service.media.renameFolder("/a", "/b");
    await stageMarker("/a", "/b");

    const result = await service.media.resumePendingFolderMoves();

    expect(result).toEqual({ finished: 1, pending: 0 });
    expect((await service.media.get(asset.id)).folder).toBe("/b");
    expect(await markers()).toEqual([]);
  });

  test("resume drops a marker that names nothing rather than retrying it forever", async () => {
    await stageMarker("", "");

    const result = await service.media.resumePendingFolderMoves();

    expect(result).toEqual({ finished: 0, pending: 0 });
    expect(await markers()).toEqual([]);
  });

  test("resume finishes several staged moves in one pass", async () => {
    const first = await service.media.save("one.png", bytes(), undefined, "/a");
    const second = await service.media.save("two.png", bytes(), undefined, "/c");
    await stageMarker("/a", "/b", "marker-one");
    await stageMarker("/c", "/d", "marker-two");

    const result = await service.media.resumePendingFolderMoves();

    expect(result).toEqual({ finished: 2, pending: 0 });
    expect((await service.media.get(first.id)).folder).toBe("/b");
    expect((await service.media.get(second.id)).folder).toBe("/d");
    expect(await markers()).toEqual([]);
  });
});
