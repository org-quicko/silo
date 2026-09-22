import { MediaPaths } from "../media/media-paths";
import type { BlobStorage } from "../ports/blob-storage";
import { MediaModes, type MediaMode } from "./media-mode";
import type { ExportSink } from "./sink/export-sink";

/**
 * The media bytes, written after the catalog rows that describe them.
 *
 * `media/` stays a top-level directory unaffected by scoping, because media is
 * instance-global (§8.1), and it stays **flat**: a key's own `media/` prefix
 * (D88) is that directory rather than part of the entry's name, so an archive
 * written now has the shape D23 fixed and an older silo reads it unchanged.
 * What the mode changes is how many of those keys are written at all — see §7.7
 * in
 * [docs/design/transfer.md](../../../../../docs/design/transfer.md).
 */
export class ExportMedia {
  /**
   * Answers how many blobs were written.
   *
   * Each blob is fetched and forwarded one at a time, so a library of any size
   * costs one asset of memory — which matters most on the store that makes this
   * slow in the first place, where every one of them is a round trip to a
   * bucket.
   */
  static async write(options: {
    sink: ExportSink;
    blobStorage: BlobStorage;
    mode: MediaMode;
    /** The catalog rows the archive carries, in the order it carried them. */
    blobKeys: readonly string[];
  }): Promise<number> {
    if (options.mode === MediaModes.None) return 0;

    const keys = await ExportMedia.keys(options.blobStorage, options.mode, options.blobKeys);
    if (keys.length === 0) return 0;

    let written = 0;
    for (const key of keys) {
      const blob = await options.blobStorage.get(key);
      // A catalog row whose bytes have gone is not an export failure: the row
      // still rides and the manifest's `files` count says one fewer arrived.
      if (!blob) continue;
      await options.sink.file(`media/${MediaPaths.archiveName(key)}`, blob.data);
      written++;
    }
    return written;
  }

  /**
   * `all` asks the store what it holds, which is what keeps a whole-instance
   * archive able to restore an upload nothing points at. `referenced` never
   * lists: it already knows its keys, and listing a bucket to discard most of
   * the answer is the cost the mode exists to avoid.
   */
  private static async keys(
    blobStorage: BlobStorage,
    mode: MediaMode,
    blobKeys: readonly string[]
  ): Promise<string[]> {
    if (mode === MediaModes.All) {
      try {
        return (await blobStorage.list()).map((item) => item.key).sort();
      } catch (caught: any) {
        // An fs store with no directory yet has nothing to export, which is not
        // the same as a store that failed to answer.
        if (caught?.code === "ENOENT") return [];
        throw caught;
      }
    }
    return [...new Set(blobKeys)].filter((key) => key.length > 0).sort();
  }
}
