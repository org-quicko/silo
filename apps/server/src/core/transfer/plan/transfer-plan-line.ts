/** What a planned transfer does with one entry, named as an import's preview names it. */
export type TransferPlanAction = "added" | "updated" | "skipped" | "rejected" | "deleted";

/**
 * One line of a transfer's `plan.ndjson` (D110): one package entry, or one
 * destination entry that replace removes.
 *
 * `destination` is the row as it was planned against, absent when there was
 * none. Its `seq` is the baseline Apply holds the store to, so a row that
 * moved since the review makes the transfer stale. A rejected line keeps the
 * reason the effective schema gave.
 */
export interface TransferPlanLine {
  collection: string;
  id: string;
  action: TransferPlanAction;
  /** The package entry's; absent on a `deleted` line. */
  rev?: number;
  updated_at?: string;
  destination?: { seq: number; rev: number; updated_at: string };
  reason?: string;
}
