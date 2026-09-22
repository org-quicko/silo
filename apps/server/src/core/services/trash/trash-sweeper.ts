import { EntryUtils } from "../../domain/entry-utils";
import type { TrashReceipt } from "../../trash/trash-receipt";
import type { ServiceContext } from "../support/service-context";
import type { TrashPurger } from "./trash-purger";
import { TrashStore } from "./trash-store";

/**
 * Purges receipts past their `expires_at`, and finishes anything a crash left
 * mid-flight (D91).
 *
 * `expires_at` is stamped at delete time rather than compared against a live
 * `retention_days`, so shortening the setting never retroactively destroys
 * content somebody was still counting on.
 */
export class TrashSweeper {
  private readonly context: ServiceContext;
  private readonly store: TrashStore;
  private readonly purger: TrashPurger;

  constructor(context: ServiceContext, store: TrashStore, purger: TrashPurger) {
    this.context = context;
    this.store = store;
    this.purger = purger;
  }

  /** Expired receipts, purged. Failures are counted, never thrown: a sweep
   *  runs on a timer with nobody watching. */
  async sweep(): Promise<{ purged: number; failed: number }> {
    const now = EntryUtils.now().toISOString();
    const { items } = await this.store.listReceipts({
      limit: TrashStore.PageSize,
      offset: 0,
    });

    let purged = 0;
    let failed = 0;
    for (const entry of items) {
      const receipt = entry.data as TrashReceipt;
      if (!receipt.expires_at || receipt.expires_at > now) continue;
      try {
        await this.context.withWriteLock(() => this.purger.purge(entry.id));
        purged += 1;
      } catch {
        failed += 1;
      }
    }
    return { purged, failed };
  }

  /**
   * Finishes the two states a crash can strand, at startup.
   *
   * `parking` is rolled forward to a purge rather than back: the live records
   * were already being removed as they were copied, so the parked half is the
   * only complete copy and the receipt that named it is incomplete. A `purging`
   * receipt simply finishes.
   */
  async resumePending(): Promise<{ finished: number; failed: number }> {
    const { items } = await this.store.listReceipts({
      limit: TrashStore.PageSize,
      offset: 0,
    });

    let finished = 0;
    let failed = 0;
    for (const entry of items) {
      const receipt = entry.data as TrashReceipt;
      if (receipt.state === "parked") continue;
      try {
        if (receipt.state === "parking") {
          await this.context.withWriteLock(() =>
            this.store.putReceipt(entry.id, { ...receipt, state: "parked" })
          );
        } else if (receipt.state === "purging") {
          await this.context.withWriteLock(() => this.purger.purge(entry.id));
        } else {
          // `restoring`: the replay is idempotent per record, so the receipt
          // returns to `parked` and the caller can try again.
          await this.context.withWriteLock(() =>
            this.store.putReceipt(entry.id, { ...receipt, state: "parked" })
          );
        }
        finished += 1;
      } catch {
        failed += 1;
      }
    }
    return { finished, failed };
  }
}
