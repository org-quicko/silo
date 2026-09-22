import { MediaCatalog } from "../../media/media-catalog";
import { MediaPaths } from "../../media/media-paths";
import type { MediaRekeyResult } from "../../media/media-rekey-result";
import type { ServiceContext } from "../support/service-context";
import type { MediaCatalogStore } from "./media-catalog-store";

/**
 * Moves assets stored under a pre-D88 key onto the key D88 gives them.
 *
 * Operator-invoked, one-off, and safe to run again — the same shape as
 * `MediaReconciler`, and for the same reason: it reads the whole catalog and
 * repairs what it finds rather than running on a timer.
 *
 * See D88 in [IMPLEMENTATION.md](../../../../../../IMPLEMENTATION.md).
 */
export class MediaRekeyer {
  private readonly context: ServiceContext;
  private readonly catalog: MediaCatalogStore;

  constructor(context: ServiceContext, catalog: MediaCatalogStore) {
    this.context = context;
    this.catalog = catalog;
  }

  async run(): Promise<MediaRekeyResult> {
    return this.context.withWriteLock(async () => {
      const result: MediaRekeyResult = {
        moved: 0,
        current: 0,
        missing: 0,
        removed: 0,
        failed: [],
      };

      for (const entry of await this.catalog.allAssets()) {
        const asset = MediaCatalog.toAsset(entry);
        const target = MediaPaths.blobKey(entry.id);

        if (asset.blob_key === target) {
          result.current++;
          continue;
        }

        // An asset mid-deletion is the saga's, and moving its bytes out from
        // under `reconcile` would strand it in `deleting` with a key nothing
        // is going to delete.
        if (asset.state === "deleting") {
          result.current++;
          continue;
        }

        try {
          await this.move(entry.id, asset.blob_key, target, asset.content_type, result);
        } catch (caught: any) {
          result.failed.push({ id: entry.id, reason: caught?.message || String(caught) });
        }
      }

      result.failed.sort((left, right) => left.id.localeCompare(right.id));
      return result;
    });
  }

  /**
   * Copy, repoint, remove — in that order, which is what makes an interrupted
   * run harmless.
   *
   * A crash after the copy leaves two objects and a record still naming the
   * old one, so the next run copies nothing (the target is already there) and
   * carries on from the repoint. A crash after the repoint leaves the old
   * object with no record, which the next run does not see at all and
   * `reconcile` reports as an orphan. The order that would lose data — remove
   * first — is the one this deliberately does not take, the same judgement
   * `save` and `replaceContent` make about bytes before records.
   *
   * The bytes are read whole rather than streamed: `BlobStorage.put` takes a
   * buffer, so one asset is held at a time. That is the cost of a copy through
   * a port with five verbs and no `copy`, and it is paid once per asset, once
   * ever.
   */
  private async move(
    id: string,
    from: string,
    to: string,
    contentType: string,
    result: MediaRekeyResult
  ): Promise<void> {
    if (!(await this.context.blobStorage.exists(to))) {
      const blob = await this.context.blobStorage.get(from);
      if (!blob) {
        // The record names bytes that are not there. Untouched on purpose:
        // `reconcile` prunes a record with no blob, and doing it here would
        // make a migration delete things.
        result.missing++;
        return;
      }
      await this.context.blobStorage.put(to, blob.data, { contentType });
    }

    const entry = await this.catalog.asset(id);
    const asset = MediaCatalog.toAsset(entry);
    await this.catalog.putAsset(id, { ...asset, blob_key: to });
    result.moved++;

    // Only now, with nothing pointing at it.
    if (from !== to) {
      await this.context.blobStorage.delete(from);
      result.removed++;
    }
  }
}
