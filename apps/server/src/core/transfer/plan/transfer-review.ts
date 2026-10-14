import type { TransferMediaReview } from "./transfer-media-review";
import type { TransferPlanCollection } from "./transfer-plan-collection";

/**
 * A planned transfer's totals (D110, D111), kept in its record. `lines` is how
 * many lines `plan.ndjson` holds, which the review pages through.
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
  media: TransferMediaReview;
}
