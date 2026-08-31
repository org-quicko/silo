import { MediaDeleteStalledError } from "../../errors/media-delete-stalled-error";
import { MediaInUseError } from "../../errors/media-in-use-error";
import { NotFoundError } from "../../errors/not-found-error";
import { MediaCatalog } from "../../media/media-catalog";
import type { ServiceContext } from "../support/service-context";
import { MediaCatalogStore } from "./media-catalog-store";

/**
 * The deletion saga (§8.1).
 *
 * The catalog and a remote object store cannot share a transaction, so
 * deletion is staged: refuse while referenced, commit to `deleting`, delete the
 * blob, drop the record. A crash after the commit leaves the asset in
 * `deleting`, which {@link resumePending} finishes at startup and which
 * `MediaReferenceGuard` refuses to let anything reference again.
 *
 * `force` (D48) skips only the usage check; the rest of the saga, and the
 * write lock around it, are unchanged.
 */
export class MediaDeletionService {
  /** Enough to sweep any realistic backlog of staged deletions in one pass. */
  private static readonly ResumeBatch = 500;

  private readonly context: ServiceContext;
  private readonly catalog: MediaCatalogStore;

  constructor(context: ServiceContext, catalog: MediaCatalogStore) {
    this.context = context;
    this.catalog = catalog;
  }

  /**
   * `force: true` deletes over a live reference (D48). The entries that held
   * it are not rewritten and the usage rows are not deleted — they are
   * derived state that honestly records entries still naming this id, and
   * `reconcile` re-derives them from entries anyway. `MediaLinks` is what
   * makes a read of one of those entries answer `null` afterwards.
   */
  async delete(id: string, options?: { force?: boolean }): Promise<void> {
    const force = options?.force === true;

    await this.context.withWriteLock(async () => {
      const entry = await this.catalog.asset(id);
      const asset = MediaCatalog.toAsset(entry);

      if (asset.state !== "deleting") {
        if (!force) {
          const tokens = MediaCatalog.tokens(entry.id, asset.blob_key);
          const usage = await this.context.store.listMediaUsages(tokens, { limit: 0 });
          if (usage.total > 0) throw new MediaInUseError(id, usage.total);
        }

        await this.catalog.putAsset(id, { ...asset, state: "deleting" });
      }

      try {
        await this.finish(id, asset.blob_key);
      } catch (error) {
        // The asset is staged and stays staged — recoverable, but only if the
        // caller learns how. A bare 500 would say nothing about `reconcile`.
        throw new MediaDeleteStalledError(id, asset.blob_key, error);
      }
    });
  }

  /** Steps 3 and 4 of the saga; idempotent, so a retry is always safe. */
  async finish(id: string, blobKey: string): Promise<void> {
    if (blobKey) await this.context.blobStorage.delete(blobKey);
    try {
      await this.catalog.deleteAsset(id);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }

  /**
   * Carries any asset left mid-delete to completion. Called at startup, where
   * it closes the window a crash between the blob delete and the record delete
   * would otherwise leave open indefinitely.
   *
   * Failures are counted, never thrown: a misconfigured blob store would
   * otherwise stop the server booting because of a deletion somebody staged
   * days ago. Startup **retries**; reversing a staged deletion is
   * `MediaReconciler`'s job.
   */
  async resumePending(): Promise<{ finished: number; pending: number }> {
    const { items } = await this.catalog.listAssets({
      filter: { op: "eq", path: "$.data.state", value: "deleting" },
      limit: MediaDeletionService.ResumeBatch,
      offset: 0,
    });

    let finished = 0;
    let pending = 0;
    for (const entry of items) {
      try {
        await this.finish(entry.id, MediaCatalog.toAsset(entry).blob_key);
        finished++;
      } catch {
        pending++;
      }
    }
    return { finished, pending };
  }
}
