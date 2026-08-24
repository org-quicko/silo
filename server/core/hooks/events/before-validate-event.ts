import type { HookEventBase } from "./hook-event-base";

/**
 * The one mutating hook's event. Returning `{ data }` replaces the value;
 * returning nothing leaves it alone.
 *
 * The envelope is deliberately absent beyond `id`: plugins shape `data`, while
 * `rev`, `seq` and the timestamps belong to core (D2, and the change-feed
 * cursor).
 */
export interface BeforeValidateEvent extends HookEventBase {
  op: "create" | "update";
  /** Absent on create: the ULID is minted after validation. */
  id?: string;
  data: any;
}
