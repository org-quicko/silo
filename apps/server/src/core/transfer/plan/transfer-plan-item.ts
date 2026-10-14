import type { TransferPlanAction } from "./transfer-plan-line";

/**
 * One plan line as the review answers it (D110). What only the destination
 * holds, a removed row's id and a destination row's `rev` and time, is shown
 * only to a key that may read that collection there, as the env copy's
 * preview does (D22). The baseline `seq` is never shown.
 */
export interface TransferPlanItem {
  collection: string;
  id?: string;
  action: TransferPlanAction;
  rev?: number;
  updated_at?: string;
  destination?: { rev: number; updated_at: string };
  reason?: string;
}
