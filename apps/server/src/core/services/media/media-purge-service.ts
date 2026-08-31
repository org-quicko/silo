import type { ServiceContext } from "../support/service-context";
import type { MediaCatalogStore } from "./media-catalog-store";

/** One id's outcome in a batch delete, in the shape `POST /api/media/delete`
 *  already answers with — purge reuses it rather than inventing a second
 *  failure shape (D49). */
export interface MediaPurgeOutcome {
  deleted: string[];
  failed: Array<Record<string, unknown>>;
}

/** What `POST /api/media/purge` answers with. */
export interface MediaPurgeResult extends MediaPurgeOutcome {
  folders_deleted: number;
}

/**
 * Empties the whole library (D49): every catalog asset, then every explicit
 * folder record.
 *
 * Pages the catalog rather than calling `allAssets()` the way
 * `MediaFolderService` does — that method's callers can afford the whole
 * catalog in memory, and purge is exactly the operation whose point is a
 * library too large for that to hold.
 *
 * The force-authority check and the per-id delete-with-outcome loop are both
 * http-layer concerns (`RouteAuth.requireForcedMediaDelete`,
 * `MediaDeleteBatch`), so this takes them as callbacks rather than importing
 * across the layer, the same shape `MediaAssetService.usages` already takes
 * its claim-visibility predicate in.
 *
 * `force` is checked once, over the whole catalog's id set, before the first
 * delete runs — never per page. A check that ran per page would let earlier
 * pages finish deleting before a later page's refusal aborted the request,
 * so the 403 the caller gets back would already be lying about what still
 * exists.
 */
export class MediaPurgeService {
  /** Assets read from the catalog per page. Independent of the bulk-delete
   *  route's own per-request id cap, which bounds a caller-supplied list —
   *  this one bounds how much of a self-derived, unbounded scan is held in
   *  memory at once. */
  static readonly BatchSize = 200;

  private readonly context: ServiceContext;
  private readonly catalog: MediaCatalogStore;

  constructor(context: ServiceContext, catalog: MediaCatalogStore) {
    this.context = context;
    this.catalog = catalog;
  }

  async run(
    force: boolean,
    requireForce: (ids: string[]) => Promise<void>,
    deleteBatch: (ids: string[], force: boolean) => Promise<MediaPurgeOutcome>
  ): Promise<MediaPurgeResult> {
    // Pre-flight, over every id purge will ever touch, before any delete
    // runs: the same shape `MediaFolderRoutes` already takes for a recursive
    // force-delete (`folderAssetIds` first, the authority check second, the
    // delete loop third). An authority check that ran per page instead would
    // let an id 250 refusal land after ids 1-200 were already gone, with the
    // response's `403` body the caller's only record of what silently
    // vanished first. Skipped entirely when unforced, which needs no such
    // check and must page exactly as it always did.
    if (force) await requireForce(await this.allAssetIds());

    const deleted: string[] = [];
    const failed: Array<Record<string, unknown>> = [];

    // The offset advances by this page's *surviving-failure* count, not its
    // size: a successful delete removes its row, shifting every later row
    // left by one, so re-reading at offset 0 would refetch nothing new while
    // a row that failed and stayed would otherwise be skipped past.
    // Advancing by the count of failures whose row still exists lands
    // exactly on the next row this pass never touched — `not_found` is
    // excluded because that row is already gone; counting it would skip past
    // one untried asset the same way a successful delete's row does.
    let offset = 0;
    while (true) {
      const { items } = await this.catalog.listAssets({
        limit: MediaPurgeService.BatchSize,
        offset,
      });
      if (items.length === 0) break;

      const ids = items.map((entry) => entry.id);
      const batch = await deleteBatch(ids, force);
      deleted.push(...batch.deleted);
      failed.push(...batch.failed);
      offset += MediaPurgeService.survivingFailureCount(batch.failed);
    }

    const foldersDeleted = failed.length === 0 ? await this.deleteAllFolders() : 0;
    return { deleted, failed, folders_deleted: foldersDeleted };
  }

  /** Every asset id currently in the catalog, paged so the force pre-flight
   *  never holds more than one page of full records at once even though it
   *  must see every id before anything is deleted — the same batch size the
   *  delete loop below uses, for the same reason. */
  private async allAssetIds(): Promise<string[]> {
    const ids: string[] = [];
    let offset = 0;
    while (true) {
      const { items } = await this.catalog.listAssets({
        limit: MediaPurgeService.BatchSize,
        offset,
      });
      if (items.length === 0) break;
      ids.push(...items.map((entry) => entry.id));
      offset += items.length;
    }
    return ids;
  }

  /** Failures whose catalog row survives the page that reported them —
   *  `media_in_use`, `media_delete_stalled`, `invalid_id`, never
   *  `not_found`, since that row was already gone before this pass touched
   *  it and does not shift anything left behind it. */
  private static survivingFailureCount(failed: Array<Record<string, unknown>>): number {
    return failed.filter((failure) => failure["code"] !== "not_found").length;
  }

  /** Every explicit `_media_folders` record, unconditionally — called only
   *  once every asset above is confirmed gone, since a folder record naming
   *  a subtree that still holds something must not silently vanish. */
  private async deleteAllFolders(): Promise<number> {
    return this.context.withWriteLock(async () => {
      const folders = await this.catalog.allFolders();
      for (const entry of folders) await this.catalog.deleteFolder(entry.id);
      return folders.length;
    });
  }
}
