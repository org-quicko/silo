import type { HookEventBase } from "./hook-event-base";

/** Observe-only, dispatched once the write has committed. */
export interface AfterWriteEvent extends HookEventBase {
  op: "create" | "update";
  id: string;
  rev: number;
  data: any;
  created_at: string;
  updated_at: string;
}
