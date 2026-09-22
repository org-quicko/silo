import { MediaCatalog } from "../../media/media-catalog";
import { MediaDisposition } from "../../media/media-disposition";
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

  async run(options: { rewrite?: boolean } = {}): Promise<MediaRekeyResult> {
    return this.context.withWriteLock(async () => {
      const result: MediaRekeyResult = {
        moved: 0,
        current: 0,
        rewritten: 0,
        missing: 0,
        removed: 0,
        failed: [],
      };

      for (const entry of await this.catalog.allAssets()) {
        const asset = MediaCatalog.toAsset(entry);
        const target = MediaPaths.blobKey(entry.id);

        if (asset.blob_key === target && !options.rewrite) {
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
          await this.move(entry.id, asset, target, result, options.rewrite === true);
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
    asset: { blob_key: string; content_type: string; filename: string },
    to: string,
    result: MediaRekeyResult,
    rewrite: boolean
  ): Promise<void> {
    const from = asset.blob_key;

    // A rewrite writes the bytes back even where the key is already right,
    // because what it is repairing is the headers on the object and those
    // cannot be read back to compare against.
    if (rewrite || !(await this.context.blobStorage.exists(to))) {
      const blob = await this.context.blobStorage.get(from);
      if (!blob) {
        // The record names bytes that are not there. Untouched on purpose:
        // `reconcile` prunes a record with no blob, and doing it here would
        // make a migration delete things.
        result.missing++;
        return;
      }
      // The copy carries what the original was written with, so an asset that
      // moves onto the new key does not lose the filename it saves under or
      // the `attachment` that keeps a navigated SVG from running (D83).
      await this.context.blobStorage.put(to, blob.data, {
        contentType: asset.content_type,
        contentDisposition: MediaDisposition.header(asset.content_type, asset.filename),
      });
    }

    if (from === to) {
      // Nothing to repoint and nothing to remove: the record already names this
      // key and the bytes were just written back over themselves.
      result.rewritten++;
      return;
    }

    const entry = await this.catalog.asset(id);
    const current = MediaCatalog.toAsset(entry);
    await this.catalog.putAsset(id, { ...current, blob_key: to });
    result.moved++;

    // Only now, with nothing pointing at it.
    await this.context.blobStorage.delete(from);
    result.removed++;
  }
}
