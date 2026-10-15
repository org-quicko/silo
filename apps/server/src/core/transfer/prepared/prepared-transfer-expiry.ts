import type { PreparedTransferRecord } from "./prepared-transfer-record";
import { PreparedTransferStates } from "./prepared-transfer-state";
import type { PreparedTransferStore } from "./prepared-transfer-store";

/**
 * The time rules a prepared transfer lives by (D109), applied whenever one is
 * read, so no timer has to run for them.
 *
 * Constants and not settings, for now: an hour is long enough to review and
 * short enough that a forgotten preview does not hold one of the four slots
 * for a day.
 */
export class PreparedTransferExpiry {
  /** How long a prepared transfer may wait for Apply. */
  static readonly TimeToLiveMs = 60 * 60 * 1000;

  /** How many may be preparing, prepared or applying at once. */
  static readonly MaxOpen = 4;

  /** How long an ended record is kept, so a client that lost a response can read it. */
  static readonly RetentionMs = 24 * 60 * 60 * 1000;

  /** When a transfer prepared at `from` expires. */
  static expiresAt(from: Date): string {
    return new Date(from.getTime() + PreparedTransferExpiry.TimeToLiveMs).toISOString();
  }

  /**
   * The record as it stands now, or null once it is gone.
   *
   * A `preparing` record that no pull in this process owns was left by one
   * that stopped, so it is removed. A `prepared` one past its expiry becomes
   * `expired` and loses its package. An ended one past its retention is
   * removed. `applying` is never touched here; recovery owns it.
   */
  static async refresh(
    store: PreparedTransferStore,
    record: PreparedTransferRecord | null,
    running: (id: string) => boolean
  ): Promise<PreparedTransferRecord | null> {
    if (!record) return null;
    const now = new Date();
    if (record.state === "preparing" && !running(record.id)) {
      await store.remove(record.id);
      return null;
    }
    if (record.state === "prepared" && Date.parse(record.expires_at) <= now.getTime()) {
      const expired: PreparedTransferRecord = { ...record, state: "expired", updated_at: now.toISOString() };
      await store.write(expired);
      await store.drop(record.id);
      return expired;
    }
    if (
      PreparedTransferStates.Ended.has(record.state) &&
      Date.parse(record.updated_at) + PreparedTransferExpiry.RetentionMs <= now.getTime()
    ) {
      await store.remove(record.id);
      return null;
    }
    return record;
  }
}
