import type { MediaMode } from "../media-mode";
import type { TransferPackageSummary } from "../package/transfer-package-summary";
import type { TransferMediaReview } from "../plan/transfer-media-review";
import type { TransferPlanCollection } from "../plan/transfer-plan-collection";
import type { TransferPlanItem } from "../plan/transfer-plan-item";
import type { TransferReview } from "../plan/transfer-review";
import type { PreparedTransferState } from "./prepared-transfer-state";

/**
 * A prepared transfer as the API answers it (D109, D110): its record without
 * the key it is bound to or the plan's baseline, and, while the package is
 * held, one page of the plan.
 */
export interface PreparedTransferView {
  id: string;
  state: PreparedTransferState;
  created_at: string;
  updated_at: string;
  expires_at: string;
  source: { url: string };
  from: { project: string; env: string };
  to: { project: string; env: string };
  selection: { collection: string; entry_ids?: string[] }[];
  mode: "merge" | "replace";
  prefer?: "local" | "remote";
  media: MediaMode;
  package?: TransferPackageSummary;
  review?: Omit<TransferReview, "lines" | "destination" | "collections" | "media"> & {
    collections: Omit<TransferPlanCollection, "baseline">[];
    media: Omit<TransferMediaReview, "resolved">;
  };
  applied_at?: string;
  entries?: { offset: number; limit: number; total: number; items: TransferPlanItem[] };
  last_error?: string;
}
