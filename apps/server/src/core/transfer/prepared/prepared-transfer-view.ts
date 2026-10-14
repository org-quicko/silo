import type { MediaMode } from "../media-mode";
import type { PackagedEntry } from "../package/packaged-entry";
import type { TransferPackageSummary } from "../package/transfer-package-summary";
import type { PreparedTransferState } from "./prepared-transfer-state";

/**
 * A prepared transfer as the API answers it (D109): its record without the key
 * it is bound to, and, while the package is held, one page of its entries.
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
  entries?: { offset: number; limit: number; total: number; items: PackagedEntry[] };
  last_error?: string;
}
