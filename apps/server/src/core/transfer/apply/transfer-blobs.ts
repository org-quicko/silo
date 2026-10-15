import { Scope } from "../../domain/scope";
import { MediaCatalog } from "../../media/media-catalog";
import type { BlobStorage } from "../../ports/blob-storage";
import type { Storage } from "../../ports/storage";
import type { TransferChanges } from "./transfer-changes";

/**
 * The files an apply writes outside its commit (D111). A blob store cannot
 * join a database transaction, so the bytes go first, under keys nothing here
 * holds yet, and are taken back when the commit does not land. A key some
 * catalog row claims is never taken back: that row is what landed.
 */
export class TransferBlobs {
  /** The first of `keys` this server already has a file at, if any. */
  static async taken(blobs: BlobStorage, keys: readonly string[]): Promise<string | undefined> {
    for (const key of keys) if (await blobs.exists(key)) return key;
    return undefined;
  }

  static async put(blobs: BlobStorage, files: TransferChanges["blobs"]): Promise<void> {
    for (const file of files) {
      await blobs.put(file.key, new Uint8Array(await Bun.file(file.file).arrayBuffer()), file.options);
    }
  }

  /** Deletes each of `keys` that no catalog row claims. */
  static async release(store: Storage, blobs: BlobStorage, keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      const { total } = await store.list(Scope.System, MediaCatalog.Collection, {
        filter: { op: "eq", path: "$.data.blob_key", value: key },
        limit: 1,
        offset: 0,
      });
      if (total === 0) await blobs.delete(key);
    }
  }
}
