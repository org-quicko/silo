import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { FsBlobStorage } from "../../src/adapters/blob/fs-blob-storage";
import { FsLayout } from "../../src/adapters/storage/fs/fs-layout";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { Scope } from "../../src/core/domain/scope";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { SystemCollections } from "../../src/core/domain/system-collections";
import { FormatVersion } from "../../src/core/transfer/format-version";
import { Importer } from "../../src/core/transfer/importer";

/**
 * Which key an archive's bytes land on (D88).
 *
 * The archive's `media/` directory is flat, so an entry's name alone cannot say
 * whether it was stored at `<name>` or at `media/<name>`. The `_media` rows the
 * archive carries are what decide, which is what keeps an archive written
 * before D88 loading to exactly the keys its own rows name — no migration, and
 * no library of bytes no record points at.
 */
describe("an archive's media loads on the keys its catalog names", () => {
  let tempDir: string;
  let store: SqliteStore;
  let blobs: FsBlobStorage;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-keys-"));
    store = await SqliteStore.open(path.join(tempDir, "dest.db"));
    blobs = new FsBlobStorage(path.join(tempDir, "blobs"));
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * An archive holding one media asset, written by hand so the catalog row's
   * `blob_key` and the flat archive name can be set independently — which is
   * the whole thing under test, and something an export cannot produce twice.
   */
  const archive = async (options: {
    name: string;
    archiveName: string;
    blobKey: string;
    bytes: string;
    /** Left out for a blob no catalog row claims. */
    catalogued?: boolean;
  }): Promise<string> => {
    const root = path.join(tempDir, options.name);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      path.join(root, "manifest.json"),
      JSON.stringify({ format_version: FormatVersion, instance_id: "source", last_seq: 0 })
    );

    const mediaDirectory = path.join(root, "media");
    await fs.mkdir(mediaDirectory, { recursive: true });
    await fs.writeFile(path.join(mediaDirectory, options.archiveName), options.bytes);

    if (options.catalogued !== false) {
      const system = path.join(root, "projects", Scope.System.project, Scope.System.env);
      await fs.mkdir(path.join(system, "schemas"), { recursive: true });
      await fs.writeFile(
        path.join(system, "schemas", `${SystemCollections.Media}${FsLayout.SchemaSuffix}`),
        JSON.stringify(SystemCollections.Schema)
      );
      const content = path.join(system, "content", SystemCollections.Media);
      await fs.mkdir(content, { recursive: true });
      const id = EntryUtils.newID();
      await fs.writeFile(
        path.join(content, `${id}.json`),
        JSON.stringify({
          id,
          rev: 1,
          seq: 0,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          data: {
            filename: "photo.jpg",
            folder: "",
            blob_key: options.blobKey,
            size: options.bytes.length,
            content_type: "image/jpeg",
            hash: "x".repeat(64),
            state: "active",
            tags: [],
          },
        })
      );
    }

    return root;
  };

  test("an archive written before D88 keeps its <id><ext> keys, unmigrated", async () => {
    const source = await archive({
      name: "legacy",
      archiveName: "01M00000000000000000000000.jpg",
      blobKey: "01M00000000000000000000000.jpg",
      bytes: "legacy-bytes",
    });

    await Importer.importDir(store, source, { mode: "merge" }, blobs);

    // Exactly where its own row says, so every reference in it still resolves.
    expect(await blobs.exists("01M00000000000000000000000.jpg")).toBe(true);
    expect(await blobs.exists("media/01M00000000000000000000000.jpg")).toBe(false);
  });

  test("an archive written after D88 loads under the prefix", async () => {
    const source = await archive({
      name: "current",
      archiveName: "01M11111111111111111111111",
      blobKey: "media/01M11111111111111111111111",
      bytes: "current-bytes",
    });

    await Importer.importDir(store, source, { mode: "merge" }, blobs);

    expect(await blobs.exists("media/01M11111111111111111111111")).toBe(true);
    expect(await blobs.exists("01M11111111111111111111111")).toBe(false);
  });

  test("a blob no row claims is left on its own name rather than renamed", async () => {
    const source = await archive({
      name: "orphan",
      archiveName: "hand-placed.bin",
      blobKey: "unused",
      bytes: "orphan-bytes",
      catalogued: false,
    });

    await Importer.importDir(store, source, { mode: "merge" }, blobs);

    expect(await blobs.exists("hand-placed.bin")).toBe(true);
    expect(await blobs.exists("media/hand-placed.bin")).toBe(false);
  });
});
