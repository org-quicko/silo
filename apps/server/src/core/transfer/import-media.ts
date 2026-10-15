import fs from "fs/promises";
import path from "path";
import { MediaDisposition } from "../media/media-disposition";
import { MediaPaths } from "../media/media-paths";
import { MimeUtils } from "../media/mime-utils";
import type { BlobPutOptions, BlobStorage } from "../ports/blob-storage";
import type { ExportManifest } from "./export-manifest";
import { ImportAuthority } from "./import-authority";
import type { ImportOptions } from "./import-options";
import { MediaModes } from "./media-mode";

/** What an archive's `_media` row says about one of its blobs. */
interface ArchivedBlob {
  key: string;
  put: BlobPutOptions;
}

/**
 * Loading an archive's media bytes, and the one question that decides whether
 * replace mode may empty the destination library first.
 *
 * See §7.7 in
 * [resources/design/transfer.md](../../../../../resources/design/transfer.md).
 */
export class ImportMedia {
  /** Where the archive keeps the media catalog it is describing its own bytes
   *  with. `_media` rows live in the system scope like every other one (§7.2). */
  private static readonly CatalogDirectory = path.join(
    "projects",
    "_system",
    "_system",
    "content",
    "_media"
  );

  /**
   * Copies the archive's `media/` directory into the blob store, answering how
   * many blobs were written.
   *
   * In merge mode a key already present is left alone: blob keys are content
   * addressed, so the same key is the same bytes and rewriting it would be work
   * with no effect.
   */
  static async load(options: {
    source: string;
    blobStorage: BlobStorage;
    manifest: ExportManifest;
    options: ImportOptions;
  }): Promise<number> {
    if (options.options.dryRun) return 0;
    if (options.options.media === MediaModes.None) return 0;

    const mediaDirectory = path.join(options.source, "media");
    let names: string[];
    try {
      const stat = await fs.stat(mediaDirectory);
      if (!stat.isDirectory()) return 0;
      names = await fs.readdir(mediaDirectory);
    } catch (caught: any) {
      if (caught?.code === "ENOENT") return 0;
      throw caught;
    }

    if (ImportAuthority.clearsLibrary(options.manifest, options.options)) {
      for (const item of await options.blobStorage.list()) {
        await options.blobStorage.delete(item.key);
      }
    }

    const blobs = await ImportMedia.blobsByArchiveName(options.source);

    const replacing = options.options.mode === "replace";
    let written = 0;
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const blob = blobs.get(name);
      const key = blob?.key ?? name;
      if (!replacing && (await options.blobStorage.exists(key))) continue;
      const bytes = await fs.readFile(path.join(mediaDirectory, name));
      await options.blobStorage.put(key, new Uint8Array(bytes), blob?.put);
      written++;
    }
    return written;
  }

  /**
   * Archive name to the key its catalog row says it is, and the type and
   * disposition to store it with, for every `_media` row the archive carries
   * (D88).
   *
   * The archive's `media/` directory is flat, so an entry's name alone cannot
   * say whether it was stored at `<name>` or at `media/<name>` — and getting
   * that wrong is a library of bytes no record points at. The rows in the
   * archive already hold the answer, so they are what decides, which is what
   * makes this exact for an archive written before D88 as well as after:
   * a row saying `<id>.jpg` loads to `<id>.jpg` and keeps resolving unmigrated,
   * a row saying `media/<id>` loads to `media/<id>`.
   *
   * The object gets the row's `content_type` and a disposition naming its
   * `filename`, as an upload's does, because a bucket serves it without silo.
   * A name no row claims falls back to itself with neither — a blob placed in
   * the store by hand, or one whose record the filter dropped, is not ours to
   * rename or describe.
   */
  private static async blobsByArchiveName(source: string): Promise<Map<string, ArchivedBlob>> {
    const directory = path.join(source, ImportMedia.CatalogDirectory);

    let files: string[];
    try {
      files = await fs.readdir(directory);
    } catch (caught: any) {
      if (caught?.code === "ENOENT") return new Map();
      throw caught;
    }

    const blobs = new Map<string, ArchivedBlob>();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      let row: Record<string, unknown>;
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(directory, file), "utf8"));
        row = parsed?.data ?? {};
      } catch {
        // A row that will not parse is the entry importer's problem to report,
        // not a reason to refuse every blob in the archive.
        continue;
      }
      const key = row.blob_key;
      if (typeof key !== "string" || !key) continue;
      blobs.set(MediaPaths.archiveName(key), { key, put: ImportMedia.presentation(row, key) });
    }
    return blobs;
  }

  /** The type and disposition a `_media` row describes, as an upload stores them. */
  private static presentation(row: Record<string, unknown>, key: string): BlobPutOptions {
    const filename = typeof row.filename === "string" && row.filename ? row.filename : undefined;
    const contentType =
      typeof row.content_type === "string" && row.content_type
        ? row.content_type
        : MimeUtils.lookup(filename ?? key);
    return { contentType, contentDisposition: MediaDisposition.header(contentType, filename) };
  }
}
