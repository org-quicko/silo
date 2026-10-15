import type { PreparedTransferState } from "./prepared-transfer-state";

/**
 * One progress line of a preparation (D75, D109, D110). The first names the
 * transfer, so a client that wants to stop the pull can cancel it by id.
 */
export interface PreparedTransferProgress {
  /** Preparing: `fetch`, `verify`, `plan`. Applying (D111): `media`, then `commit`. */
  phase: "fetch" | "verify" | "plan" | "media" | "commit";
  transfer: { id: string; state: PreparedTransferState; expires_at: string };
}
