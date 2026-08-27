import type { HookEventBase } from "./hook-event-base";

/** Veto-only: the data has been validated and the envelope built, so a rewrite
 *  here would store what the schema never judged. */
export interface BeforeWriteEvent extends HookEventBase {
  op: "create" | "update";
  id: string;
  rev: number;
  data: any;
}
