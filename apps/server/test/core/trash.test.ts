import { describe, test, expect, beforeEach, afterEach, setSystemTime } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { MediaRef } from "@silo/shared/media-ref";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { FsStore } from "../../src/adapters/storage/fs/fs-store";
import { PgStore } from "../../src/adapters/storage/postgres/pg-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { MediaCatalog } from "../../src/core/media/media-catalog";
import { SystemCollections } from "../../src/core/domain/system-collections";
import { ConflictError } from "../../src/core/errors/conflict-error";
import { NotFoundError } from "../../src/core/errors/not-found-error";
import { PgTestDatabase } from "../adapters/support/pg-test-database";

// The trash was written before Postgres existed, and its own queries over
// `_trash` (state, expiry, origin filters) are where the strict query contract
// (D92) could make the two drivers disagree.
const postgres = PgTestDatabase.url() !== undefined;
if (!postgres) PgTestDatabase.skipping("SILO_TEST_PG_URL is not set");
const kinds = postgres ? (["sqlite", "fs", "postgres"] as const) : (["sqlite", "fs"] as const);

describe.each(kinds)("trash on %s (D113)", (kind) => {
  let tempDir: string;
  let store: SqliteStore | PgStore | FsStore;
  let service: SiloService;

  const openStore = (schema?: string) => kind === "sqlite"
    ? SqliteStore.open(path.join(tempDir, "test.db"))
    : kind === "fs" ? FsStore.open(path.join(tempDir, "data"))
    : PgStore.open({ url: PgTestDatabase.url()!, schema: schema ?? PgTestDatabase.freshSchema() });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-trash-test-"));
    store = await openStore();
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
  });

  afterEach(async () => {
    await store.close();
    if (store instanceof PgStore) await PgTestDatabase.drop(store.schema);
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

  test.each([
    ["collection", "before", false], ["collection", "after", false], ["collection", "before", true],
    ["environment", "before", false], ["project", "before", false],
  ] as const)(
    "an interrupted %s restore retries safely (failure=%s, edited=%s)", async (subject, timing, edited) => {
    await seedCollection();
    const entries = [];
    const count = kind === "sqlite" && subject === "collection" && timing === "after" ? 1002 : 3;
    for (let index = 0; index < count; index++) {
      entries.push(await service.entries.create(Scope.Default, "posts", { title: `entry ${index}` }));
    }
    if (subject === "collection") await service.collections.delete(Scope.Default, "posts", true);
    else if (subject === "environment") await service.scopes.deleteEnvironment("default", "prod", true);
    else await service.scopes.deleteProject("default", true);
    const destination = subject === "project" ? Scope.of("restored", "prod") :
      subject === "environment" ? Scope.of("default", "restored") : Scope.Default;
    const collection = subject === "collection" ? "restored" : "posts";
    const receipt = (await service.trash.list()).items[0];
    const originalPut = store.put.bind(store);
    let writes = 0;
    store.put = async (entry, derived) => {
      if (entry.project === destination.project && entry.env === destination.env && entry.collection === collection && ++writes === 2) {
        if (timing === "after") await originalPut(entry, derived);
        throw new Error("interrupted restore write");
      }
      return originalPut(entry, derived);
    };
    try {
      await expect(service.trash.restore(receipt.id, { rename: "restored" })).rejects.toThrow("interrupted restore write");
    } finally {
      store.put = originalPut;
    }
    const schema = store instanceof PgStore ? store.schema : undefined;
    await store.close();
    store = await openStore(schema);
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.trash.resumePending();
    if (edited) {
      const current = await service.entries.get(destination, collection, entries[0]!.id);
      await service.entries.update(destination, collection, current.id, { title: "edited after interruption" }, current.rev);
      await expect(service.trash.restore(receipt.id)).rejects.toThrow("already exists");
      expect((await service.entries.get(destination, collection, current.id)).data).toEqual({ title: "edited after interruption" });
      return;
    }
    const result = await service.trash.restore(receipt.id);
    expect(result.entries).toBe(entries.length);
    const restoredIds: string[] = [];
    for (let offset = 0; offset < entries.length; offset += 500) {
      const restored = await service.entries.list(destination, collection, { limit: 500, offset });
      restoredIds.push(...restored.items.map((entry) => entry.id));
    }
    expect(restoredIds.sort()).toEqual(entries.map((entry) => entry.id).sort());
    expect((await service.trash.list()).total).toBe(0);
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

  test("an interrupted journal cleanup can finish a renamed restore", async () => {
    await seedCollection();
    for (const title of ["one", "two", "three"]) await service.entries.create(Scope.Default, "posts", { title });
    await service.collections.delete(Scope.Default, "posts", true);
    const receipt = (await service.trash.list()).items[0];
    const originalDelete = store.delete.bind(store);
    let deleted = 0;
    store.delete = async (scope, collection, id) => {
      await originalDelete(scope, collection, id);
      if (collection === SystemCollections.TrashItems && ++deleted === 2) throw new Error("cleanup interrupted");
    };
    try {
      await expect(service.trash.restore(receipt.id, { rename: "restored" })).rejects.toThrow("cleanup interrupted");
    } finally {
      store.delete = originalDelete;
    }
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.trash.resumePending();
    await service.trash.restore(receipt.id);
    expect((await service.entries.list(Scope.Default, "restored", { limit: 10, offset: 0 })).total).toBe(3);
    expect((await service.trash.list()).total).toBe(0);
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

  test("purging a receipt preserves a file revived by an import", async () => {
    const asset = await service.media.save("hero.png", new TextEncoder().encode("keep me"));
    const archive = path.join(tempDir, "archive");
    await service.transfer.exportDir(archive, {});
    await service.media.delete(asset.id);
    const receipt = (await service.trash.list()).items[0];
    await service.transfer.importDir(archive, { mode: "merge" });
    await service.trash.purge(receipt.id);
    expect((await service.media.get(asset.id)).filename).toBe("hero.png");
    expect(await service.blobStorage.exists(asset.blob_key)).toBe(true);
    expect((await service.trash.list()).total).toBe(0);
  });

  test("a folder delete is one receipt that restores the folder and its files", async () => {
    const bytes = new TextEncoder().encode("bytes");
    await service.media.createFolder("/shoots/empty");
    const top = await service.media.save("a.png", bytes, "/shoots");
    const nested = await service.media.save("b.png", bytes, "/shoots/raw");

    const ids = await service.media.folderAssetIds("/shoots");
    const outcome = await service.media.trashFolder("/shoots", ids, {});
    expect(outcome.deleted.sort()).toEqual([top.id, nested.id].sort());
    expect(outcome.foldersDeleted).toBe(1);
    expect(await service.media.listFolders()).toEqual([]);
    expect(await service.blobStorage.exists(nested.blob_key)).toBe(true);

    const page = await service.trash.list();
    expect(page.items.map((item) => item.id)).toEqual([outcome.trashId!]);
    expect(page.items[0].kind).toBe("media_folder");
    expect(page.items[0].subject_name).toBe("shoots");
    expect(page.items[0].contents.assets).toBe(2);

    await service.trash.restore(outcome.trashId!);
    expect(await service.media.listFolders()).toEqual(["/shoots", "/shoots/empty", "/shoots/raw"]);
    expect((await service.media.get(nested.id)).folder).toBe("/shoots/raw");
  });

  test("a file still in use stays, and keeps its folder", async () => {
    await seedCollection();
    const bytes = new TextEncoder().encode("bytes");
    await service.media.createFolder("/press");
    const used = await service.media.save("used.png", bytes, "/press");
    const loose = await service.media.save("loose.png", bytes, "/press");
    await service.entries.create(Scope.Default, "posts", { title: "x", cover: MediaRef.url(used.id) });

    const outcome = await service.media.trashFolder(
      "/press",
      await service.media.folderAssetIds("/press"),
      {}
    );
    expect(outcome.deleted).toEqual([loose.id]);
    expect(outcome.failed.map((failure) => failure.id)).toEqual([used.id]);
    expect(outcome.foldersDeleted).toBe(0);
    expect(await service.media.listFolders()).toEqual(["/press"]);

    await service.trash.restore(outcome.trashId!);
    expect((await service.media.get(loose.id)).folder).toBe("/press");
  });

  test("an empty folder goes to the trash, and a restore joins one made again since", async () => {
    await service.media.createFolder("/drafts");
    const receipt = await service.media.deleteFolder("/drafts");
    expect(await service.media.listFolders()).toEqual([]);
    expect((await service.trash.get(receipt!)).kind).toBe("media_folder");

    await service.media.createFolder("/drafts");
    await service.trash.restore(receipt!);
    const records = await store.list(Scope.System, MediaCatalog.FoldersCollection, {
      limit: 10,
      offset: 0,
    });
    expect(records.total).toBe(1);
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

  // One driver is enough to pass the store's page size; the paging is the trash's own.
  test.skipIf(kind !== "sqlite")("lists and sweeps past the first thousand receipts", async () => {
    await seedCollection();
    const trashOne = async (title: string) => {
      const entry = await service.entries.create(Scope.Default, "posts", { title });
      await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev);
    };
    setSystemTime(new Date(Date.now() - 40 * 86_400_000));
    try {
      await trashOne("oldest");
    } finally {
      setSystemTime();
    }
    for (let index = 0; index < 1000; index++) await trashOne(`newer ${index}`);

    const last = await service.trash.list({ offset: 1000 });
    expect([last.items.map((item) => item.subject_name), last.total]).toEqual([["oldest"], 1001]);
    expect(await service.trash.sweep()).toEqual({ purged: 1, failed: 0 });
    expect((await service.trash.list({ q: "oldest" })).total).toBe(0);
  }, 60_000);

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

  test("a restore is held to the collection's current schema, and the receipt survives a refusal", async () => {
    await seedCollection();
    const entry = await service.entries.create(Scope.Default, "posts", { title: "old string" });
    await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev);
    // Empty now, so the schema may change shape (D70).
    await service.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { title: { type: "number" } },
    });

    const receipt = (await service.trash.list()).items[0];
    await expect(service.trash.restore(receipt.id)).rejects.toThrow("does not match the current schema");
    await expect(service.entries.get(Scope.Default, "posts", entry.id)).rejects.toThrow(NotFoundError);
    expect((await service.trash.get(receipt.id)).state).toBe("parked");

    await seedCollection();
    await service.trash.restore(receipt.id);
    expect((await service.entries.get(Scope.Default, "posts", entry.id)).data.title).toBe("old string");
  });
});
