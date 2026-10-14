import type { PreparedTransferState } from "./prepared-transfer-state";

/**
 * One progress line of a preparation (D75, D109). The first names the
 * transfer, so a client that wants to stop the pull can cancel it by id.
 */
export interface PreparedTransferProgress {
  phase: "fetch" | "verify";
  transfer: { id: string; state: PreparedTransferState; expires_at: string };
}
