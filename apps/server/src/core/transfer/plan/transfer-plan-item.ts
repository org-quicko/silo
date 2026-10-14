import type { TransferPlanAction } from "./transfer-plan-line";

/**
 * One plan line as the review answers it (D110, D111). What only the
 * destination holds, a removed row's id and a destination row's `rev` and
 * time, is shown only to a key that may read that collection there, as the env
 * copy's preview does (D22); the media library is readable by every key. The
 * baseline `seq` is never shown.
 */
export interface TransferPlanItem {
  collection: string;
  id?: string;
  action: TransferPlanAction;
  name?: string;
  rev?: number;
  updated_at?: string;
  destination?: { rev: number; updated_at: string };
  reason?: string;
  unresolved?: string[];
}
