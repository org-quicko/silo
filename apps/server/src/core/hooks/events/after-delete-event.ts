import type { HookEventBase } from "./hook-event-base";

/** Observe-only, dispatched once the delete has committed. */
export interface AfterDeleteEvent extends HookEventBase {
  op: "delete";
  id: string;
  rev: number;
}
