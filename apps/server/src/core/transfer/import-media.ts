import fs from "fs/promises";
import path from "path";
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

    const replacing = options.options.mode === "replace";
    let written = 0;
    for (const name of names) {
      if (name.startsWith(".")) continue;
      if (!replacing && (await options.blobStorage.exists(name))) continue;
      const bytes = await fs.readFile(path.join(mediaDirectory, name));
      await options.blobStorage.put(name, new Uint8Array(bytes));
      written++;
    }
    return written;
  }
}
