import type { TransferPlanCollection } from "./transfer-plan-collection";

/**
 * A planned transfer's totals (D110), kept in its record. `lines` is how many
 * lines `plan.ndjson` holds, which the review pages through.
 */
export interface TransferReview {
  planned_at: string;
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  rejected: number;
  lines: number;
  collections: TransferPlanCollection[];
}
