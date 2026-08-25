import type { Scope } from "../../domain/scope";
import type { CollectionDeletedEvent } from "../../hooks/events";
import type { WriteContext } from "../../hooks/write-context";

/**
 * The hook payload a collection erase dispatches (D36, closing D37's F6).
 *
 * Its own builder rather than a sixth method on `EntryEvents`, because it is not
 * about an entry: there is no id, no rev and no `data` to carry, and the one
 * number it does carry — how many entries went — has no counterpart there.
 */
export class CollectionEvents {
  /** What an observing hook sees after a collection and its entries are gone. */
  static deleted(
    writeContext: WriteContext,
    scope: Scope,
    collection: string,
    erased: number,
    cause: CollectionDeletedEvent["cause"]
  ): CollectionDeletedEvent {
    return {
      op: "delete",
      origin: writeContext.origin,
      chain: writeContext.chain,
      scope: { project: scope.project, env: scope.env },
      collection,
      erased,
      cause,
    };
  }
}
