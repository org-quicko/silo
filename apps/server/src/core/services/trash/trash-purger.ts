import type { TrashedAsset, TrashItem } from "../../trash/trash-item";
import type { TrashReceipt } from "../../trash/trash-receipt";
import type { ServiceContext } from "../support/service-context";
import { TrashStore } from "./trash-store";

/**
 * Destroys a receipt and everything it parked (D91).
 *
 * Blobs first, then the parked records, then the receipt — the order a
 * media delete already uses (D23), so an interrupted purge leaves a receipt in
 * `purging` that the resumer finishes rather than a blob nothing references.
 */
export class TrashPurger {
  private readonly context: ServiceContext;
  private readonly store: TrashStore;

  constructor(context: ServiceContext, store: TrashStore) {
    this.context = context;
    this.store = store;
  }

  /** Callers hold the write lock. Safe to run again on a receipt it half
   *  finished. */
  async purge(id: string): Promise<void> {
    const entry = await this.store.findReceipt(id);
    if (!entry) return;

    const receipt = entry.data as TrashReceipt;
    if (receipt.state !== "purging") {
      await this.store.putReceipt(
        id,
        { ...receipt, state: "purging" },
        entry.created_at instanceof Date ? entry.created_at : new Date(entry.created_at)
      );
    }

    await this.deleteBlobs(id);
    await this.store.deleteItems(id);
    await this.store.deleteReceipt(id);
  }

  /**
   * A blob whose delete fails is skipped rather than fatal: a misconfigured
   * store would otherwise keep a receipt undeletable forever, and
   * `silo media reconcile` is what finds bytes nothing references.
   */
  private async deleteBlobs(trashId: string): Promise<void> {
    let offset = 0;
    while (true) {
      const page = await this.store.listItems(trashId, {
        limit: TrashStore.PageSize,
        offset,
      });
      if (page.items.length === 0) return;
      for (const entry of page.items) {
        const item = entry.data as TrashItem;
        if (item.kind !== "media") continue;
        const key = (item.record as TrashedAsset).blob_key;
        if (!key) continue;
        try {
          await this.context.blobStorage.delete(key);
        } catch {
          // Reported by reconcile, not by failing the purge.
        }
      }
      offset += page.items.length;
      if (offset >= page.total) return;
    }
  }
}
