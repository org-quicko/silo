import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { MediaRef } from "@silo/shared/media-ref";
import { MediaInUseError } from "../../src/core/errors/media-in-use-error";
import { MediaDeleteStalledError } from "../../src/core/errors/media-delete-stalled-error";
import { ConflictError } from "../../src/core/errors/conflict-error";
import { NotFoundError } from "../../src/core/errors/not-found-error";

describe("media catalog (D23)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let mediaDir: string;
  let service: SiloService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    mediaDir = path.join(tempDir, "media");
    service = new SiloService(store, { mediaDir });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const seedCollection = async () => {
    await service.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });
  };

  test("upload catalogues the file and addresses it by id", async () => {
    const content = new TextEncoder().encode("hello world media");
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");

    const asset = await service.media.save("my photo.png", content, undefined, "/marketing");

    expect(asset.hash).toBe(expectedHash);
    expect(asset.filename).toBe("my photo.png");
    expect(asset.folder).toBe("/marketing");
    expect(asset.content_type).toBe("image/png");
    expect(asset.state).toBe("active");
    // Addressed by catalog id, not by a path derived from the name.
    expect(asset.url).toBe(`/media/${asset.id}`);
    expect(asset.blob_key).toBe(`${asset.id}.png`);

    const fetched = await service.media.bytes(asset.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.data).toEqual(content);
    expect(fetched!.filename).toBe("my photo.png");
  });

  test("rename and move rewrite no blob and no entry", async () => {
    await seedCollection();
    const asset = await service.media.save("draft.png", new TextEncoder().encode("bytes"));
    const entry = await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    const moved = await service.media.update(asset.id, {
      filename: "hero.png",
      folder: "/marketing/launch",
      tags: ["hero", "hero"],
    });

    expect(moved.filename).toBe("hero.png");
    expect(moved.folder).toBe("/marketing/launch");
    expect(moved.tags).toEqual(["hero"]);
    // The bytes never moved, and the entry still points at the same id.
    expect(moved.blob_key).toBe(asset.blob_key);
    const after = await service.entries.get(Scope.Default, "posts", entry.id);
    expect(after.data.cover).toBe(MediaRef.url(asset.id));
    expect(after.rev).toBe(entry.rev);
  });

  test("a referenced asset cannot be deleted, and can be once the entry drops it", async () => {
    await seedCollection();
    const asset = await service.media.save("in-use.png", new TextEncoder().encode("bytes"));
    const entry = await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    await expect(service.media.delete(asset.id)).rejects.toThrow(MediaInUseError);

    // Still active — a refused delete must not stage anything.
    expect((await service.media.get(asset.id)).state).toBe("active");
    expect((await service.media.get(asset.id)).usage_count).toBe(1);

    await service.entries.update(Scope.Default, "posts", entry.id, {}, entry.rev);
    await service.media.delete(asset.id);

    await expect(service.media.get(asset.id)).rejects.toThrow(NotFoundError);
    expect(await service.media.bytes(asset.blob_key)).toBeNull();
  });

  test("force delete succeeds over a live reference, and leaves the usage row behind (D48)", async () => {
    await seedCollection();
    const asset = await service.media.save("forced.png", new TextEncoder().encode("bytes"));
    const entry = await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    // Unforced still refuses, exactly as before.
    await expect(service.media.delete(asset.id)).rejects.toThrow(MediaInUseError);

    await service.media.delete(asset.id, { force: true });
    await expect(service.media.get(asset.id)).rejects.toThrow(NotFoundError);
    expect(await service.media.bytes(asset.blob_key)).toBeNull();

    // The entry is untouched — no rewrite, dangling reference and all.
    const after = await service.entries.get(Scope.Default, "posts", entry.id);
    expect(after.data.cover).toBe(MediaRef.url(asset.id));

    // The usage row is adapter-owned derived state and is deliberately not
    // deleted alongside the record: it honestly records that the entry still
    // names this id, and `reconcile` would re-derive it from the entry anyway.
    expect(await store.countMediaUsages([asset.id])).toEqual(new Map([[asset.id, 1]]));
  });

  test("deleting the entry releases the asset", async () => {
    await seedCollection();
    const asset = await service.media.save("bound.png", new TextEncoder().encode("bytes"));
    const entry = await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    await expect(service.media.delete(asset.id)).rejects.toThrow(MediaInUseError);
    await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev);
    await service.media.delete(asset.id);
    await expect(service.media.get(asset.id)).rejects.toThrow(NotFoundError);
  });

  test("deleting the whole project releases assets its entries held", async () => {
    const scope = Scope.of("acme", "prod");
    await service.scopes.createProject("acme");
    await service.scopes.createEnvironment("acme", "prod");
    await service.collections.putSchema(scope, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });
    const asset = await service.media.save("scoped.png", new TextEncoder().encode("bytes"));
    await service.entries.create(scope, "posts", { cover: MediaRef.url(asset.id) });

    await expect(service.media.delete(asset.id)).rejects.toThrow(MediaInUseError);

    // The bulk path: entries go away without an individual delete call, which
    // is precisely why usages live on `Storage` rather than a layer above it.
    await service.scopes.deleteProject("acme", true);
    await service.media.delete(asset.id);
    await expect(service.media.get(asset.id)).rejects.toThrow(NotFoundError);
  });

  test("usages report the true total but only referrers the caller may read", async () => {
    await seedCollection();
    await service.scopes.createProject("other");
    await service.scopes.createEnvironment("other", "prod");
    const otherScope = Scope.of("other", "prod");
    await service.collections.putSchema(otherScope, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });

    const asset = await service.media.save("shared.png", new TextEncoder().encode("bytes"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });
    await service.entries.create(otherScope, "posts", { cover: MediaRef.url(asset.id) });

    const visible = await service.media.usages(asset.id, {}, (project) => project === "default");
    expect(visible.total).toBe(2); // the count is never filtered
    expect(visible.visible).toBe(1); // the rows are
    expect(visible.items[0].project).toBe("default");
  });

  test("visible is the true count of readable referrers, not how many fit on the requested page (D49 audit fix)", async () => {
    await seedCollection();
    const asset = await service.media.save("popular.png", new TextEncoder().encode("bytes"));
    for (let index = 0; index < 25; index++) {
      await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });
    }

    // A page of 20 asked for, but every one of the 25 referrers is readable —
    // visible must report 25, not 20, or an asset like this would look
    // under-visible to a caller who can in fact read every referrer.
    const usage = await service.media.usages(asset.id, { limit: 20 }, () => true);
    expect(usage.total).toBe(25);
    expect(usage.items).toHaveLength(20);
    expect(usage.visible).toBe(25);
    expect(usage.visibleCapped).toBe(false);
  });

  test("an asset being deleted refuses new references", async () => {
    await seedCollection();
    const asset = await service.media.save("staged.png", new TextEncoder().encode("bytes"));

    // Stage the asset the way a crashed delete would leave it.
    await service.media.update(asset.id, {});
    const staged = await store.get(Scope.System, "_media", asset.id);
    await store.put({ ...staged, rev: staged.rev + 1, data: { ...staged.data, state: "deleting" } }, { usages: [], search: null });

    await expect(
      service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) })
    ).rejects.toThrow(ConflictError);

    // …and startup carries the deletion to completion.
    expect(await service.media.resumePendingDeletions()).toEqual({ finished: 1, pending: 0 });
    await expect(service.media.get(asset.id)).rejects.toThrow(NotFoundError);
  });

  test("pre-D23 path references still block deletion until backfill", async () => {
    await seedCollection();
    // A blob uploaded before the catalog existed, and an entry naming it by path.
    const legacyKey = "abc123_legacy.png";
    await service.blobStorage.put(legacyKey, new TextEncoder().encode("old bytes"));
    await service.entries.create(Scope.Default, "posts", { cover: `/media/${legacyKey}` });

    const response = await service.media.reconcile();
    expect(response.adopted).toBe(1);

    const adopted = (await service.media.list()).items.find((a) => a.blob_key === legacyKey)!;
    expect(adopted.filename).toBe("legacy.png");
    // Counted through the `blob:` token even though the entry never names the id.
    expect(adopted.usage_count).toBe(1);
    await expect(service.media.delete(adopted.id)).rejects.toThrow(MediaInUseError);
  });

  test("search filters by name, type and folder", async () => {
    await service.media.save("annual-report.pdf", new TextEncoder().encode("a"), "application/pdf", "/docs");
    await service.media.save("hero.png", new TextEncoder().encode("b"), "image/png", "/marketing");
    await service.media.save("banner.png", new TextEncoder().encode("c"), "image/png", "/marketing/launch");

    expect((await service.media.list({ text: "hero" })).total).toBe(1);
    expect((await service.media.list({ type: "image/" })).total).toBe(2);
    expect((await service.media.list({ folder: "/marketing" })).total).toBe(1);
    // Recursive must not match "/marketing-old"-style siblings by prefix alone.
    expect((await service.media.list({ folder: "/marketing", recursive: true })).total).toBe(2);
    expect((await service.media.list({ folder: "" })).total).toBe(0);

    const paged = await service.media.list({ limit: 2, offset: 0, sort: "filename" });
    expect(paged.items.map((a) => a.filename)).toEqual(["annual-report.pdf", "banner.png"]);
    expect(paged.total).toBe(3);
  });

  test("folders exist when created or when an asset names one", async () => {
    await service.media.createFolder("/empty/shelf");
    await service.media.save("hero.png", new TextEncoder().encode("b"), "image/png", "/marketing/launch");

    // Ancestors count as existing, so a tree renders without gaps.
    expect(await service.media.listFolders()).toEqual([
      "/empty",
      "/empty/shelf",
      "/marketing",
      "/marketing/launch",
    ]);

    // Deleting a folder must never be a way around the reference guard.
    await expect(service.media.deleteFolder("/marketing")).rejects.toThrow(ConflictError);
    await service.media.deleteFolder("/empty");
    expect(await service.media.listFolders()).toEqual(["/marketing", "/marketing/launch"]);
  });

  test("folder paths are validated, not trusted", async () => {
    await expect(service.media.createFolder("../escape")).rejects.toThrow();
    await expect(service.media.createFolder("/a/../b")).rejects.toThrow();
    await expect(service.media.save("x.png", new Uint8Array([1]), undefined, "/ok/../nope")).rejects.toThrow();
  });

  test("export/import round trip preserves the catalog, not just the bytes", async () => {
    await service.media.createFolder("/empty");
    const asset = await service.media.save(
      "portable.txt",
      new TextEncoder().encode("portable content file"),
      "text/plain",
      "/docs"
    );

    const exportDest = path.join(tempDir, "export-dir");
    await service.transfer.exportDir(exportDest, { withKeys: false });
    expect((await fs.readdir(path.join(exportDest, "media"))).length).toBe(1);

    const storeDest = await SqliteStore.open(path.join(tempDir, "dest.db"));
    const destinationService = new SiloService(storeDest, { mediaDir: path.join(tempDir, "media-dest") });
    await destinationService.transfer.importDir(exportDest, { mode: "merge" });

    const restored = await destinationService.media.list();
    expect(restored.total).toBe(1);
    // The filename and folder survive — bytes alone would restore a library
    // with no organisation in it, which is why the catalog is never gated on
    // --with-keys.
    expect(restored.items[0].filename).toBe("portable.txt");
    expect(restored.items[0].folder).toBe("/docs");
    expect(restored.items[0].id).toBe(asset.id);
    expect(await destinationService.media.listFolders()).toEqual(["/docs", "/empty"]);

    await storeDest.close();
  });

  test("an edit round trip does not corrupt the reference", async () => {
    await seedCollection();
    const asset = await service.media.save("round.png", new TextEncoder().encode("bytes"));
    const entry = await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    // What a read hands back is a resolved URL, and a client that edits one
    // field and PUTs the whole object back returns exactly that. It must
    // still be the same reference afterwards.
    const resolved = `http://localhost:8090/media/${asset.id}`;
    const updated = await service.entries.update(
      Scope.Default,
      "posts",
      entry.id,
      { cover: resolved },
      entry.rev
    );

    expect(updated.data.cover).toBe(MediaRef.url(asset.id));
    expect((await service.media.get(asset.id)).usage_count).toBe(1);
    await expect(service.media.delete(asset.id)).rejects.toThrow(MediaInUseError);
  });

  test("a pre-D23 blob path is not mistaken for a catalog id", async () => {
    await seedCollection();
    // `<sha256>_<name>` and `<ulid><ext>` both carry a character a bare ULID
    // never does, so neither canonicalises into a reference.
    const entry = await service.entries.create(Scope.Default, "posts", {
      cover: "/media/abc123_legacy.png",
    });
    expect(entry.data.cover).toBe("/media/abc123_legacy.png");
  });

  test("reconcile returns an asset to active when the blob delete keeps failing", async () => {
    const asset = await service.media.save("stuck.png", new TextEncoder().encode("bytes"));

    // A blob store that accepts everything except the delete — the shape of a
    // rotated credential or a changed bucket policy.
    const realDelete = service.blobStorage.delete.bind(service.blobStorage);
    service.blobStorage.delete = async () => {
      throw new Error("AccessDenied");
    };

    // The failure carries its own remedy rather than surfacing as a bare 500.
    await expect(service.media.delete(asset.id)).rejects.toThrow(MediaDeleteStalledError);
    try {
      await service.media.delete(asset.id);
    } catch (caught) {
      const stalled = caught as MediaDeleteStalledError;
      expect(stalled.mediaId).toBe(asset.id);
      expect(stalled.blobKey).toBe(asset.blob_key);
      expect(stalled.reason).toBe("AccessDenied");
      expect(stalled.message).toContain("silo media reconcile");
    }
    // Staged, and refusing to be referenced — the state that would otherwise
    // strand the asset forever.
    expect((await service.media.get(asset.id)).state).toBe("deleting");

    // Startup retries and reports, but never throws and never reverses.
    expect(await service.media.resumePendingDeletions()).toEqual({ finished: 0, pending: 1 });
    expect((await service.media.get(asset.id)).state).toBe("deleting");

    // The operator-invoked repair reverses it, automatically and in the report.
    const response = await service.media.reconcile();
    expect(response.aborted).toBe(1);
    expect(response.finished).toBe(0);
    expect(response.pending).toBe(0);
    // Its bytes are still claimed, so it is not also reported as an orphan.
    expect(response.orphans).toEqual([]);
    expect(response.adopted).toBe(0);

    const revived = await service.media.get(asset.id);
    expect(revived.state).toBe("active");
    expect(revived.filename).toBe("stuck.png");
    expect(revived.blob_key).toBe(asset.blob_key);

    // Usable again: referencing it no longer conflicts.
    await seedCollection();
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });
    expect((await service.media.get(asset.id)).usage_count).toBe(1);

    // And once the blob store recovers, deleting works normally again.
    service.blobStorage.delete = realDelete;
    await expect(service.media.delete(asset.id)).rejects.toThrow(MediaInUseError);
  });

  test("reconcile completes an interrupted deletion rather than reversing it", async () => {
    const asset = await service.media.save("interrupted.png", new TextEncoder().encode("bytes"));

    // Staged, but the process died before the blob delete — so the bytes are
    // still there. Presence alone must not be read as "abort": this is an
    // interrupted deletion and it should finish.
    const staged = await store.get(Scope.System, "_media", asset.id);
    await store.put(
      { ...staged, rev: staged.rev + 1, data: { ...staged.data, state: "deleting" } },
      { usages: [], search: null }
    );
    expect(await service.blobStorage.exists(asset.blob_key)).toBe(true);

    const response = await service.media.reconcile();
    expect(response.finished).toBe(1);
    expect(response.aborted).toBe(0);
    await expect(service.media.get(asset.id)).rejects.toThrow(NotFoundError);
    expect(await service.blobStorage.exists(asset.blob_key)).toBe(false);
  });
});
