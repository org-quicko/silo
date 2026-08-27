import { EntryUtils } from "../../domain/entry-utils";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaPaths } from "../../media/media-paths";
import { MimeUtils } from "../../media/mime-utils";
import type { MediaAsset } from "../../media/media-asset";
import type { MediaReconcileResult } from "../../media/media-reconcile-result";
import type { ServiceContext } from "../support/service-context";
import type { MediaCatalogStore } from "./media-catalog-store";
import type { MediaDeletionService } from "./media-deletion-service";

/**
 * Reconciles the catalog against the blob store: adopts blobs that predate D23
 * or that a half-finished upload left behind, finishes staged deletions, prunes
 * records whose bytes are gone, and reports orphans without deleting them.
 *
 * Operator-invoked repair, not a background job.
 */
export class MediaReconciler {
  private readonly context: ServiceContext;
  private readonly catalog: MediaCatalogStore;
  private readonly deletion: MediaDeletionService;

  constructor(
    context: ServiceContext,
    catalog: MediaCatalogStore,
    deletion: MediaDeletionService
  ) {
    this.context = context;
    this.catalog = catalog;
    this.deletion = deletion;
  }

  async run(): Promise<MediaReconcileResult> {
    return this.context.withWriteLock(async () => {
      const result: MediaReconcileResult = {
        adopted: 0,
        pruned: 0,
        finished: 0,
        aborted: 0,
        pending: 0,
        orphans: [],
      };

      const claimedBlobKeys = await this.reconcileRecords(result);
      await this.adoptOrphans(result, claimedBlobKeys);

      result.orphans.sort();
      return result;
    });
  }

  /** Walks every catalog record, returning the blob keys still spoken for. */
  private async reconcileRecords(result: MediaReconcileResult): Promise<Set<string>> {
    const claimed = new Set<string>();

    for (const entry of await this.catalog.allAssets()) {
      const asset = MediaCatalog.toAsset(entry);

      if (asset.state === "deleting") {
        await this.settleStagedDeletion(entry.id, asset, result, claimed);
        continue;
      }

      if (asset.blob_key && !(await this.context.blobStorage.exists(asset.blob_key))) {
        await this.catalog.deleteAsset(entry.id);
        result.pruned++;
        continue;
      }

      claimed.add(asset.blob_key);
    }

    return claimed;
  }

  /**
   * Attempts the deletion rather than judging by whether the blob is still
   * there: a crash between staging and the blob delete leaves the bytes in
   * place too, and that case should *complete*, not reverse. An actual failure
   * is the only thing that distinguishes "interrupted" from "impossible".
   */
  private async settleStagedDeletion(
    id: string,
    asset: MediaAsset,
    result: MediaReconcileResult,
    claimed: Set<string>
  ): Promise<void> {
    try {
      await this.deletion.finish(id, asset.blob_key);
      result.finished++;
      return;
    } catch {
      // Fall through to reviving the record.
    }

    try {
      await this.catalog.putAsset(id, { ...asset, state: "active" });
      result.aborted++;
    } catch {
      result.pending++;
    }
    // Either way its bytes are still spoken for, so it must not also be
    // reported as an orphan on the same pass.
    claimed.add(asset.blob_key);
  }

  /**
   * A pre-D23 key is `<sha256>_<name>`; anything else is reported rather than
   * adopted, because inventing a record for bytes of unknown provenance is a
   * guess, not a repair.
   */
  private async adoptOrphans(
    result: MediaReconcileResult,
    claimed: Set<string>
  ): Promise<void> {
    for (const blob of await this.context.blobStorage.list()) {
      if (claimed.has(blob.key)) continue;

      const split = blob.key.indexOf("_");
      if (split <= 0) {
        result.orphans.push(blob.key);
        continue;
      }

      const filename = MediaPaths.normalizeFilename(blob.key.slice(split + 1));
      const asset: MediaAsset = {
        filename,
        folder: "",
        // Adopts the existing key rather than renaming the object: pre-D23
        // entries hold `/media/<key>`, and those references are counted through
        // the `blob:` token, which only resolves while the bytes stay put.
        blob_key: blob.key,
        size: blob.size,
        content_type: blob.contentType || MimeUtils.lookup(filename),
        hash: blob.key.slice(0, split),
        state: "active",
        tags: [],
      };
      await this.catalog.putAsset(EntryUtils.newID(), asset, blob.lastModified);
      result.adopted++;
    }
  }
}
