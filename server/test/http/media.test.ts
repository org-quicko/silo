import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { SqliteStore } from "../../adapters/storage/sqlite/sqlite-store";
import { Service } from "../../core/service/service";
import { Scope } from "../../core/domain/scope";
import { MediaRef } from "@silo/shared/media-ref";
import { MediaInUseError } from "../../core/errors/media-in-use-error";
import { MediaDeleteStalledError } from "../../core/errors/media-delete-stalled-error";
import { ConflictError } from "../../core/errors/conflict-error";
import { NotFoundError } from "../../core/errors/not-found-error";

describe("media catalog (D23)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let mediaDir: string;
  let svc: Service;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    mediaDir = path.join(tempDir, "media");
    svc = new Service(store, { mediaDir });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const seedCollection = async () => {
    await svc.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });
  };

  test("upload catalogues the file and addresses it by id", async () => {
    const content = new TextEncoder().encode("hello world media");
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");

    const asset = await svc.saveMedia("my photo.png", content, undefined, "/marketing");

    expect(asset.hash).toBe(expectedHash);
    expect(asset.filename).toBe("my photo.png");
    expect(asset.folder).toBe("/marketing");
    expect(asset.content_type).toBe("image/png");
    expect(asset.state).toBe("active");
    // Addressed by catalog id, not by a path derived from the name.
    expect(asset.url).toBe(`/media/${asset.id}`);
    expect(asset.blob_key).toBe(`${asset.id}.png`);

    const fetched = await svc.getMedia(asset.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.data).toEqual(content);
    expect(fetched!.filename).toBe("my photo.png");
  });

  test("rename and move rewrite no blob and no entry", async () => {
    await seedCollection();
    const asset = await svc.saveMedia("draft.png", new TextEncoder().encode("bytes"));
    const entry = await svc.createEntry(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    const moved = await svc.updateMediaAsset(asset.id, {
      filename: "hero.png",
      folder: "/marketing/launch",
      tags: ["hero", "hero"],
    });

    expect(moved.filename).toBe("hero.png");
    expect(moved.folder).toBe("/marketing/launch");
    expect(moved.tags).toEqual(["hero"]);
    // The bytes never moved, and the entry still points at the same id.
    expect(moved.blob_key).toBe(asset.blob_key);
    const after = await svc.getEntry(Scope.Default, "posts", entry.id);
    expect(after.data.cover).toBe(MediaRef.url(asset.id));
    expect(after.rev).toBe(entry.rev);
  });

  test("a referenced asset cannot be deleted, and can be once the entry drops it", async () => {
    await seedCollection();
    const asset = await svc.saveMedia("in-use.png", new TextEncoder().encode("bytes"));
    const entry = await svc.createEntry(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    await expect(svc.deleteMedia(asset.id)).rejects.toThrow(MediaInUseError);

    // Still active — a refused delete must not stage anything.
    expect((await svc.getMediaAsset(asset.id)).state).toBe("active");
    expect((await svc.getMediaAsset(asset.id)).usage_count).toBe(1);

    await svc.updateEntry(Scope.Default, "posts", entry.id, {}, entry.rev);
    await svc.deleteMedia(asset.id);

    await expect(svc.getMediaAsset(asset.id)).rejects.toThrow(NotFoundError);
    expect(await svc.getMedia(asset.blob_key)).toBeNull();
  });

  test("deleting the entry releases the asset", async () => {
    await seedCollection();
    const asset = await svc.saveMedia("bound.png", new TextEncoder().encode("bytes"));
    const entry = await svc.createEntry(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    await expect(svc.deleteMedia(asset.id)).rejects.toThrow(MediaInUseError);
    await svc.deleteEntry(Scope.Default, "posts", entry.id, entry.rev);
    await svc.deleteMedia(asset.id);
    await expect(svc.getMediaAsset(asset.id)).rejects.toThrow(NotFoundError);
  });

  test("deleting the whole project releases assets its entries held", async () => {
    const scope = Scope.of("acme", "prod");
    await svc.createProject("acme");
    await svc.createEnvironment("acme", "prod");
    await svc.putSchema(scope, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });
    const asset = await svc.saveMedia("scoped.png", new TextEncoder().encode("bytes"));
    await svc.createEntry(scope, "posts", { cover: MediaRef.url(asset.id) });

    await expect(svc.deleteMedia(asset.id)).rejects.toThrow(MediaInUseError);

    // The bulk path: entries go away without an individual delete call, which
    // is precisely why usages live on `Storage` rather than a layer above it.
    await svc.deleteProject("acme", true);
    await svc.deleteMedia(asset.id);
    await expect(svc.getMediaAsset(asset.id)).rejects.toThrow(NotFoundError);
  });

  test("usages report the true total but only referrers the caller may read", async () => {
    await seedCollection();
    await svc.createProject("other");
    await svc.createEnvironment("other", "prod");
    const otherScope = Scope.of("other", "prod");
    await svc.putSchema(otherScope, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });

    const asset = await svc.saveMedia("shared.png", new TextEncoder().encode("bytes"));
    await svc.createEntry(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });
    await svc.createEntry(otherScope, "posts", { cover: MediaRef.url(asset.id) });

    const visible = await svc.listMediaUsages(asset.id, {}, (project) => project === "default");
    expect(visible.total).toBe(2); // the count is never filtered
    expect(visible.visible).toBe(1); // the rows are
    expect(visible.items[0].project).toBe("default");
  });

  test("an asset being deleted refuses new references", async () => {
    await seedCollection();
    const asset = await svc.saveMedia("staged.png", new TextEncoder().encode("bytes"));

    // Stage the asset the way a crashed delete would leave it.
    await svc.updateMediaAsset(asset.id, {});
    const staged = await store.get(Scope.System, "_media", asset.id);
    await store.put({ ...staged, rev: staged.rev + 1, data: { ...staged.data, state: "deleting" } }, { usages: [], search: null });

    await expect(
      svc.createEntry(Scope.Default, "posts", { cover: MediaRef.url(asset.id) })
    ).rejects.toThrow(ConflictError);

    // …and startup carries the deletion to completion.
    expect(await svc.resumePendingMediaDeletions()).toEqual({ finished: 1, pending: 0 });
    await expect(svc.getMediaAsset(asset.id)).rejects.toThrow(NotFoundError);
  });

  test("pre-D23 path references still block deletion until backfill", async () => {
    await seedCollection();
    // A blob uploaded before the catalog existed, and an entry naming it by path.
    const legacyKey = "abc123_legacy.png";
    await svc.blobStore.put(legacyKey, new TextEncoder().encode("old bytes"));
    await svc.createEntry(Scope.Default, "posts", { cover: `/media/${legacyKey}` });

    const res = await svc.reconcileMedia();
    expect(res.adopted).toBe(1);

    const adopted = (await svc.listMedia()).items.find((a) => a.blob_key === legacyKey)!;
    expect(adopted.filename).toBe("legacy.png");
    // Counted through the `blob:` token even though the entry never names the id.
    expect(adopted.usage_count).toBe(1);
    await expect(svc.deleteMedia(adopted.id)).rejects.toThrow(MediaInUseError);
  });

  test("search filters by name, type and folder", async () => {
    await svc.saveMedia("annual-report.pdf", new TextEncoder().encode("a"), "application/pdf", "/docs");
    await svc.saveMedia("hero.png", new TextEncoder().encode("b"), "image/png", "/marketing");
    await svc.saveMedia("banner.png", new TextEncoder().encode("c"), "image/png", "/marketing/launch");

    expect((await svc.listMedia({ q: "hero" })).total).toBe(1);
    expect((await svc.listMedia({ type: "image/" })).total).toBe(2);
    expect((await svc.listMedia({ folder: "/marketing" })).total).toBe(1);
    // Recursive must not match "/marketing-old"-style siblings by prefix alone.
    expect((await svc.listMedia({ folder: "/marketing", recursive: true })).total).toBe(2);
    expect((await svc.listMedia({ folder: "" })).total).toBe(0);

    const paged = await svc.listMedia({ limit: 2, offset: 0, sort: "filename" });
    expect(paged.items.map((a) => a.filename)).toEqual(["annual-report.pdf", "banner.png"]);
    expect(paged.total).toBe(3);
  });

  test("folders exist when created or when an asset names one", async () => {
    await svc.createMediaFolder("/empty/shelf");
    await svc.saveMedia("hero.png", new TextEncoder().encode("b"), "image/png", "/marketing/launch");

    // Ancestors count as existing, so a tree renders without gaps.
    expect(await svc.listMediaFolders()).toEqual([
      "/empty",
      "/empty/shelf",
      "/marketing",
      "/marketing/launch",
    ]);

    // Deleting a folder must never be a way around the reference guard.
    await expect(svc.deleteMediaFolder("/marketing")).rejects.toThrow(ConflictError);
    await svc.deleteMediaFolder("/empty");
    expect(await svc.listMediaFolders()).toEqual(["/marketing", "/marketing/launch"]);
  });

  test("folder paths are validated, not trusted", async () => {
    await expect(svc.createMediaFolder("../escape")).rejects.toThrow();
    await expect(svc.createMediaFolder("/a/../b")).rejects.toThrow();
    await expect(svc.saveMedia("x.png", new Uint8Array([1]), undefined, "/ok/../nope")).rejects.toThrow();
  });

  test("export/import round trip preserves the catalog, not just the bytes", async () => {
    await svc.createMediaFolder("/empty");
    const asset = await svc.saveMedia(
      "portable.txt",
      new TextEncoder().encode("portable content file"),
      "text/plain",
      "/docs"
    );

    const exportDest = path.join(tempDir, "export-dir");
    await svc.exportDir(exportDest, { withKeys: false });
    expect((await fs.readdir(path.join(exportDest, "media"))).length).toBe(1);

    const storeDest = await SqliteStore.open(path.join(tempDir, "dest.db"));
    const svcDest = new Service(storeDest, { mediaDir: path.join(tempDir, "media-dest") });
    await svcDest.importDir(exportDest, { mode: "merge" });

    const restored = await svcDest.listMedia();
    expect(restored.total).toBe(1);
    // The filename and folder survive — bytes alone would restore a library
    // with no organisation in it, which is why the catalog is never gated on
    // --with-keys.
    expect(restored.items[0].filename).toBe("portable.txt");
    expect(restored.items[0].folder).toBe("/docs");
    expect(restored.items[0].id).toBe(asset.id);
    expect(await svcDest.listMediaFolders()).toEqual(["/docs", "/empty"]);

    await storeDest.close();
  });

  test("an edit round trip does not corrupt the reference", async () => {
    await seedCollection();
    const asset = await svc.saveMedia("round.png", new TextEncoder().encode("bytes"));
    const entry = await svc.createEntry(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    // What a read hands back is a resolved URL, and a client that edits one
    // field and PUTs the whole object back returns exactly that. It must
    // still be the same reference afterwards.
    const resolved = `http://localhost:8090/media/${asset.id}`;
    const updated = await svc.updateEntry(
      Scope.Default,
      "posts",
      entry.id,
      { cover: resolved },
      entry.rev
    );

    expect(updated.data.cover).toBe(MediaRef.url(asset.id));
    expect((await svc.getMediaAsset(asset.id)).usage_count).toBe(1);
    await expect(svc.deleteMedia(asset.id)).rejects.toThrow(MediaInUseError);
  });

  test("a pre-D23 blob path is not mistaken for a catalog id", async () => {
    await seedCollection();
    // `<sha256>_<name>` and `<ulid><ext>` both carry a character a bare ULID
    // never does, so neither canonicalises into a reference.
    const entry = await svc.createEntry(Scope.Default, "posts", {
      cover: "/media/abc123_legacy.png",
    });
    expect(entry.data.cover).toBe("/media/abc123_legacy.png");
  });

  test("reconcile returns an asset to active when the blob delete keeps failing", async () => {
    const asset = await svc.saveMedia("stuck.png", new TextEncoder().encode("bytes"));

    // A blob store that accepts everything except the delete — the shape of a
    // rotated credential or a changed bucket policy.
    const realDelete = svc.blobStore.delete.bind(svc.blobStore);
    svc.blobStore.delete = async () => {
      throw new Error("AccessDenied");
    };

    // The failure carries its own remedy rather than surfacing as a bare 500.
    await expect(svc.deleteMedia(asset.id)).rejects.toThrow(MediaDeleteStalledError);
    try {
      await svc.deleteMedia(asset.id);
    } catch (err) {
      const stalled = err as MediaDeleteStalledError;
      expect(stalled.mediaId).toBe(asset.id);
      expect(stalled.blobKey).toBe(asset.blob_key);
      expect(stalled.reason).toBe("AccessDenied");
      expect(stalled.message).toContain("silo media reconcile");
    }
    // Staged, and refusing to be referenced — the state that would otherwise
    // strand the asset forever.
    expect((await svc.getMediaAsset(asset.id)).state).toBe("deleting");

    // Startup retries and reports, but never throws and never reverses.
    expect(await svc.resumePendingMediaDeletions()).toEqual({ finished: 0, pending: 1 });
    expect((await svc.getMediaAsset(asset.id)).state).toBe("deleting");

    // The operator-invoked repair reverses it, automatically and in the report.
    const res = await svc.reconcileMedia();
    expect(res.aborted).toBe(1);
    expect(res.finished).toBe(0);
    expect(res.pending).toBe(0);
    // Its bytes are still claimed, so it is not also reported as an orphan.
    expect(res.orphans).toEqual([]);
    expect(res.adopted).toBe(0);

    const revived = await svc.getMediaAsset(asset.id);
    expect(revived.state).toBe("active");
    expect(revived.filename).toBe("stuck.png");
    expect(revived.blob_key).toBe(asset.blob_key);

    // Usable again: referencing it no longer conflicts.
    await seedCollection();
    await svc.createEntry(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });
    expect((await svc.getMediaAsset(asset.id)).usage_count).toBe(1);

    // And once the blob store recovers, deleting works normally again.
    svc.blobStore.delete = realDelete;
    await expect(svc.deleteMedia(asset.id)).rejects.toThrow(MediaInUseError);
  });

  test("reconcile completes an interrupted deletion rather than reversing it", async () => {
    const asset = await svc.saveMedia("interrupted.png", new TextEncoder().encode("bytes"));

    // Staged, but the process died before the blob delete — so the bytes are
    // still there. Presence alone must not be read as "abort": this is an
    // interrupted deletion and it should finish.
    const staged = await store.get(Scope.System, "_media", asset.id);
    await store.put(
      { ...staged, rev: staged.rev + 1, data: { ...staged.data, state: "deleting" } },
      { usages: [], search: null }
    );
    expect(await svc.blobStore.exists(asset.blob_key)).toBe(true);

    const res = await svc.reconcileMedia();
    expect(res.finished).toBe(1);
    expect(res.aborted).toBe(0);
    await expect(svc.getMediaAsset(asset.id)).rejects.toThrow(NotFoundError);
    expect(await svc.blobStore.exists(asset.blob_key)).toBe(false);
  });
});
