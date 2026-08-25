import type { HookEventBase } from "./hook-event-base";

/** Veto-only. Carries the entry itself, because a hook that can see only an id
 *  cannot decide anything about it. */
export interface BeforeDeleteEvent extends HookEventBase {
  op: "delete";
  id: string;
  rev: number;
  data: any;
}
