import fs from "fs/promises";
import path from "path";
import { MediaPaths } from "../media/media-paths";
import type { BlobStorage } from "../ports/blob-storage";
import type { ExportManifest } from "./export-manifest";
import { ImportAuthority } from "./import-authority";
import type { ImportOptions } from "./import-options";
import { MediaModes } from "./media-mode";

/**
 * Loading an archive's media bytes, and the one question that decides whether
 * replace mode may empty the destination library first.
 *
 * See §7.7 in
 * [docs/design/transfer.md](../../../../../docs/design/transfer.md).
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

    const keys = await ImportMedia.keysByArchiveName(options.source);

    const replacing = options.options.mode === "replace";
    let written = 0;
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const key = keys.get(name) ?? name;
      if (!replacing && (await options.blobStorage.exists(key))) continue;
      const bytes = await fs.readFile(path.join(mediaDirectory, name));
      await options.blobStorage.put(key, new Uint8Array(bytes));
      written++;
    }
    return written;
  }

  /**
   * Archive name to the key its catalog row says it is, for every `_media` row
   * the archive carries (D88).
   *
   * The archive's `media/` directory is flat, so an entry's name alone cannot
   * say whether it was stored at `<name>` or at `media/<name>` — and getting
   * that wrong is a library of bytes no record points at. The rows in the
   * archive already hold the answer, so they are what decides, which is what
   * makes this exact for an archive written before D88 as well as after:
   * a row saying `<id>.jpg` loads to `<id>.jpg` and keeps resolving unmigrated,
   * a row saying `media/<id>` loads to `media/<id>`.
   *
   * A name no row claims falls back to itself — a blob placed in the store by
   * hand, or one whose record the filter dropped, is not ours to rename.
   */
  private static async keysByArchiveName(source: string): Promise<Map<string, string>> {
    const directory = path.join(source, ImportMedia.CatalogDirectory);

    let files: string[];
    try {
      files = await fs.readdir(directory);
    } catch (caught: any) {
      if (caught?.code === "ENOENT") return new Map();
      throw caught;
    }

    const keys = new Map<string, string>();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      let blobKey: unknown;
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(directory, file), "utf8"));
        blobKey = parsed?.data?.blob_key;
      } catch {
        // A row that will not parse is the entry importer's problem to report,
        // not a reason to refuse every blob in the archive.
        continue;
      }
      if (typeof blobKey !== "string" || !blobKey) continue;
      keys.set(MediaPaths.archiveName(blobKey), blobKey);
    }
    return keys;
  }
}
