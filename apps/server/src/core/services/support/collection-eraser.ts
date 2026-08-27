import type { Storage } from "../../ports/storage";
import type { Scope } from "../../domain/scope";
import { NotFoundError } from "../../errors/not-found-error";

/**
 * Shared bulk-delete logic for wiping a collection's entries and schema
 * within one scope. Callers are responsible for authorization checks and
 * holding the write mutex — this class performs no locking of its own.
 *
 * It dispatches no hooks, and that is deliberate rather than the oversight D37's
 * F6 reported. It runs **inside** the write lock, and D37 pinned that hook
 * dispatch happens outside it: a plugin that writes back through the HTTP
 * surface has to find a free lock rather than wait on the one its own caller
 * holds. So the count comes back instead, and the caller — which owns the lock
 * and knows when it released it — dispatches `collection.afterDelete` after.
 */
export class CollectionEraser {
  /** How many entries were erased. Returned rather than logged, because it is
   *  what the collection-level hook carries and the caller is the only place
   *  that can dispatch it safely. */
  static async erase(store: Storage, scope: Scope, collection: string): Promise<number> {
    let erased = 0;
    while (true) {
      const { items } = await store.list(scope, collection, { limit: 500, offset: 0 });
      if (items.length === 0) {
        break;
      }
      for (const entry of items) {
        await store.delete(scope, collection, entry.id);
        erased += 1;
      }
    }
    // A collection can hold entries and no schema — an import archive may
    // carry `content/<collection>/` with nothing under `schemas/`. Erasing
    // its entries is still the whole job, so a missing schema is success, not
    // a failure that would leave the caller unable to empty the scope.
    try {
      await store.deleteSchema(scope, collection);
    } catch (caught) {
      if (!(caught instanceof NotFoundError)) {
        throw caught;
      }
    }
    return erased;
  }
}
