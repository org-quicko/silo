import type { HookEventBase } from "./hook-event-base";

/**
 * Observe-only, dispatched once a collection and everything in it is gone
 * (D36, closing D37's F6).
 *
 * One event for the whole collection rather than one per entry. That is the
 * point of it: a forced delete is a bulk operation, and the fact worth
 * delivering is "this collection is gone, and it held this many entries" — not
 * the identity of each row, which the plugin can no longer read anyway.
 */
export interface CollectionDeletedEvent extends HookEventBase {
  op: "delete";

  /** How many entries the delete erased. `0` is an ordinary answer: deleting an
   *  empty collection still removes it. */
  erased: number;

  /**
   * Which delete erased it.
   *
   * A mirroring plugin cares: `"collection"` is one collection going away, and
   * `"environment"` or `"project"` means every sibling is going with it, so the
   * useful reaction is to drop the scope rather than one table.
   */
  cause: "collection" | "environment" | "project";
}
