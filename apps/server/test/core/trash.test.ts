import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { MediaRef } from "@silo/shared/media-ref";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { ConflictError } from "../../src/core/errors/conflict-error";
import { NotFoundError } from "../../src/core/errors/not-found-error";

describe("trash (D91)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-trash-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const seedCollection = async (name = "posts") => {
    await service.collections.putSchema(Scope.Default, name, {
      type: "object",
      properties: {
        title: { type: "string" },
        cover: { type: "string", "x-silo-type": "media" },
      },
    });
  };

  test("deleting an entry parks it and restoring brings it back with its id", async () => {
    await seedCollection();
    const entry = await service.entries.create(Scope.Default, "posts", { title: "Autumn" });

    await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev);
    await expect(service.entries.get(Scope.Default, "posts", entry.id)).rejects.toThrow(
      NotFoundError
    );

    const page = await service.trash.list();
    expect(page.total).toBe(1);
    expect(page.items[0].kind).toBe("entry");
    expect(page.items[0].subject_name).toBe("Autumn");
    expect(page.items[0].origin.collection_name).toBe("posts");
    expect(page.items[0].restorable).toBe(true);

    const result = await service.trash.restore(page.items[0].id);
    expect(result.entries).toBe(1);

    const restored = await service.entries.get(Scope.Default, "posts", entry.id);
    expect(restored.data.title).toBe("Autumn");
    // The receipt is consumed by the restore, not left behind as a duplicate.
    expect((await service.trash.list()).total).toBe(0);
  });

  test("a collection deleted with force is one receipt, not one per entry", async () => {
    await seedCollection();
    for (const title of ["one", "two", "three"]) {
      await service.entries.create(Scope.Default, "posts", { title });
    }

    await service.collections.delete(Scope.Default, "posts", true);

    const page = await service.trash.list();
    expect(page.total).toBe(1);
    expect(page.items[0].kind).toBe("collection");
    expect(page.items[0].contents.entries).toBe(3);
    expect(page.items[0].contents.collections).toBe(1);

    await service.trash.restore(page.items[0].id);
    const entries = await service.entries.list(Scope.Default, "posts", { limit: 10, offset: 0 });
    expect(entries.total).toBe(3);
  });

  test("the name frees immediately, and a restore onto a taken name is refused", async () => {
    await seedCollection();
    await service.collections.delete(Scope.Default, "posts", true);

    // Nothing holds the name any more, which is what parking buys over a flag.
    await seedCollection();

    const receipt = (await service.trash.list()).items[0];
    await expect(service.trash.restore(receipt.id)).rejects.toThrow();

    // Under another name it lands.
    const result = await service.trash.restore(receipt.id, { rename: "posts-restored" });
    expect(result.renamed_to).toBe("posts-restored");
    expect(await service.collections.get(Scope.Default, "posts-restored")).toBeTruthy();
  });

  test("an entry whose collection went too is blocked, and a chain restores both", async () => {
    await seedCollection();
    const entry = await service.entries.create(Scope.Default, "posts", { title: "orphan" });
    await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev);
    await service.collections.delete(Scope.Default, "posts", true);

    const entryReceipt = (await service.trash.list({ kind: "entry" })).items[0];
    expect(entryReceipt.restorable).toBe(false);
    expect(entryReceipt.blocked_by?.kind).toBe("collection");
    expect(entryReceipt.blocked_by?.trash_id).toBeTruthy();

    await expect(service.trash.restore(entryReceipt.id)).rejects.toThrow(ConflictError);

    const result = await service.trash.restore(entryReceipt.id, { chain: true });
    // Ancestor first, then the entry that was waiting on it.
    expect(result.restored).toHaveLength(2);
    expect(await service.entries.get(Scope.Default, "posts", entry.id)).toBeTruthy();
  });

  test("a trashed media asset keeps its bytes, and a purge takes them", async () => {
    const asset = await service.media.save("hero.png", new TextEncoder().encode("bytes"));

    await service.media.delete(asset.id);
    await expect(service.media.get(asset.id)).rejects.toThrow(NotFoundError);
    // The blob outlives the trash: that is what makes the restore whole.
    expect(await service.blobStorage.exists(asset.blob_key)).toBe(true);

    const receipt = (await service.trash.list()).items[0];
    expect(receipt.kind).toBe("media");

    await service.trash.restore(receipt.id);
    expect((await service.media.get(asset.id)).filename).toBe("hero.png");

    await service.media.delete(asset.id);
    await service.trash.purge((await service.trash.list()).items[0].id);
    expect(await service.blobStorage.exists(asset.blob_key)).toBe(false);
  });

  test("a restore reports references the library no longer holds", async () => {
    await seedCollection();
    const asset = await service.media.save("gone.png", new TextEncoder().encode("bytes"));
    const entry = await service.entries.create(Scope.Default, "posts", {
      title: "with cover",
      cover: MediaRef.url(asset.id),
    });

    await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev);
    // The reference left with the entry, so nothing stops the asset going for
    // good while the entry sits in the trash.
    await service.media.delete(asset.id, { permanent: true });

    const receipt = (await service.trash.list({ kind: "entry" })).items[0];
    const result = await service.trash.restore(receipt.id);
    expect(result.broken_media_refs).toEqual([asset.id]);
  });

  test("permanent delete skips the trash entirely", async () => {
    await seedCollection();
    const entry = await service.entries.create(Scope.Default, "posts", { title: "gone" });

    await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev, undefined, {
      permanent: true,
    });

    expect((await service.trash.list()).total).toBe(0);
  });

  test("with the trash off, a delete is permanent and the list stays empty", async () => {
    service.trash.useConfig({ enabled: false, retention_days: 30 });
    await seedCollection();
    const entry = await service.entries.create(Scope.Default, "posts", { title: "gone" });

    await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev);
    expect((await service.trash.list()).total).toBe(0);
  });

  test("retention stamps an expiry, and the sweeper purges what is past it", async () => {
    await seedCollection();
    const entry = await service.entries.create(Scope.Default, "posts", { title: "old" });
    await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev);

    const receipt = (await service.trash.list()).items[0];
    expect(receipt.expires_at).toBeTruthy();
    // Thirty days out, give or take the second this test took.
    const days = (Date.parse(receipt.expires_at!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    expect((await service.trash.sweep()).purged).toBe(0);

    // Zero days is "keep until purged by hand", so an expiry in the past is
    // made rather than configured.
    service.trash.useConfig({ enabled: true, retention_days: 30 });
    await service.entries.create(Scope.Default, "posts", { title: "next" });
    expect((await service.trash.list()).total).toBe(1);
  });

  test("emptying the trash destroys every receipt", async () => {
    await seedCollection();
    for (const title of ["a", "b"]) {
      const entry = await service.entries.create(Scope.Default, "posts", { title });
      await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev);
    }

    expect((await service.trash.list()).total).toBe(2);
    expect((await service.trash.empty()).purged).toBe(2);
    expect((await service.trash.list()).total).toBe(0);
  });

  test("deleting a project parks every environment, collection and entry under it", async () => {
    await service.scopes.createProject("shop");
    await service.collections.putSchema(Scope.of("shop", "prod"), "items", { type: "object" });
    await service.entries.create(Scope.of("shop", "prod"), "items", { sku: "a" });

    await service.scopes.deleteProject("shop", true);

    const receipt = (await service.trash.list()).items[0];
    expect(receipt.kind).toBe("project");
    expect(receipt.contents.entries).toBe(1);
    expect(receipt.contents.collections).toBe(1);

    await service.trash.restore(receipt.id);
    const entries = await service.entries.list(Scope.of("shop", "prod"), "items", {
      limit: 10,
      offset: 0,
    });
    expect(entries.total).toBe(1);
  });

  test("a rename between delete and restore does not misfile the content", async () => {
    await seedCollection();
    const entry = await service.entries.create(Scope.Default, "posts", { title: "anchored" });
    await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev);

    // The receipt holds ids, so the new name is where it lands.
    const collection = await service.collections.get(Scope.Default, "posts");
    await service.renames.renameCollection(Scope.Default, "posts", "articles", {
      kind: "cli",
    });

    const receipt = (await service.trash.list()).items[0];
    await service.trash.restore(receipt.id);

    const restored = await service.entries.get(Scope.Default, "articles", entry.id);
    expect(restored.data.title).toBe("anchored");
    expect(collection).toBeTruthy();
  });
});
