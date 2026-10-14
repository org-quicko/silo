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
import type { BlobPutOptions } from "../../src/core/ports/blob-storage";
import { FormatVersion } from "../../src/core/transfer/format-version";
import { Importer } from "../../src/core/transfer/importer";

/**
 * An fs store that also records what each put was told about presentation,
 * which a file cannot hold and a bucket serves (D88).
 */
class RecordingBlobStorage extends FsBlobStorage {
  readonly putOptions = new Map<string, BlobPutOptions | undefined>();

  override async put(key: string, data: Uint8Array, options?: BlobPutOptions): Promise<void> {
    this.putOptions.set(key, options);
    await super.put(key, data, options);
  }
}

/**
 * Which key an archive's bytes land on, and what they are stored as (D88).
 *
 * The archive's `media/` directory is flat, so an entry's name alone cannot say
 * whether it was stored at `<name>` or at `media/<name>`. The `_media` rows the
 * archive carries are what decide, which is what keeps an archive written
 * before D88 loading to exactly the keys its own rows name — no migration, and
 * no library of bytes no record points at. The same rows give the type and the
 * disposition, so a bucket that serves an imported object answers as silo
 * would.
 */
describe("an archive's media loads on the keys its catalog names", () => {
  let tempDir: string;
  let store: SqliteStore;
  let blobs: RecordingBlobStorage;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-keys-"));
    store = await SqliteStore.open(path.join(tempDir, "dest.db"));
    blobs = new RecordingBlobStorage(path.join(tempDir, "blobs"));
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
    /** The row's `filename` and `content_type`; a JPEG photo when left out. */
    filename?: string;
    contentType?: string;
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
            filename: options.filename ?? "photo.jpg",
            folder: "",
            blob_key: options.blobKey,
            size: options.bytes.length,
            content_type: options.contentType ?? "image/jpeg",
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

  test("a blob is stored with its row's type and a disposition naming its file", async () => {
    const source = await archive({
      name: "svg",
      archiveName: "01M22222222222222222222222",
      blobKey: "media/01M22222222222222222222222",
      bytes: "<svg/>",
      filename: "diagram.svg",
      contentType: "image/svg+xml",
    });

    await Importer.importDir(store, source, { mode: "merge" }, blobs);

    // An extensionless key gives a bucket nothing to guess a type from, and an
    // SVG it served as application/octet-stream would not draw.
    expect(blobs.putOptions.get("media/01M22222222222222222222222")).toEqual({
      contentType: "image/svg+xml",
      contentDisposition: "attachment; filename*=UTF-8''diagram.svg",
    });
  });

  test("a key from before D88 is stored with its row's type and disposition too", async () => {
    const source = await archive({
      name: "legacy-presented",
      archiveName: "01M33333333333333333333333.jpg",
      blobKey: "01M33333333333333333333333.jpg",
      bytes: "legacy-bytes",
    });

    await Importer.importDir(store, source, { mode: "merge" }, blobs);

    expect(blobs.putOptions.get("01M33333333333333333333333.jpg")).toEqual({
      contentType: "image/jpeg",
      contentDisposition: "inline; filename*=UTF-8''photo.jpg",
    });
  });

  test("a blob no row claims is stored with neither", async () => {
    const source = await archive({
      name: "orphan-presented",
      archiveName: "hand-placed.bin",
      blobKey: "unused",
      bytes: "orphan-bytes",
      catalogued: false,
    });

    await Importer.importDir(store, source, { mode: "merge" }, blobs);

    expect(blobs.putOptions.has("hand-placed.bin")).toBe(true);
    expect(blobs.putOptions.get("hand-placed.bin")).toBeUndefined();
  });
});
