import { EntryUtils } from "../../domain/entry-utils";
import type { TrashReceipt } from "../../trash/trash-receipt";
import type { ServiceContext } from "../support/service-context";
import type { TrashPurger } from "./trash-purger";
import type { TrashStore } from "./trash-store";

/**
 * Purges receipts past their `expires_at`, and finishes anything a crash left
 * mid-flight (D113).
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
    let purged = 0;
    let failed = 0;
    for (const entry of await this.store.allReceipts()) {
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
   * Settles the states a crash can strand, at startup.
   *
   * `parking` is rolled back: capture is copy-only and is committed before the
   * delete erases anything, so the live content is still whole and the parked
   * half is a partial duplicate. The delete simply did not happen. A `purging`
   * receipt finishes.
   */
  async resumePending(): Promise<{ finished: number; failed: number }> {
    let finished = 0;
    let failed = 0;
    for (const entry of await this.store.allReceipts()) {
      const receipt = entry.data as TrashReceipt;
      if (receipt.state === "parked") continue;
      try {
        if (receipt.state === "parking") {
          await this.context.withWriteLock(() => this.rollBack(entry.id));
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

  /** Drops a partial capture without touching a blob, whose bytes still belong
   *  to the live record. Items first, so an interrupted rollback leaves a
   *  `parking` receipt the next start finds again. */
  private async rollBack(id: string): Promise<void> {
    await this.store.deleteItems(id);
    await this.store.deleteReceipt(id);
  }
}
