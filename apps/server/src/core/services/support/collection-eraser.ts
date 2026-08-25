import type { Storage } from "../../ports/storage";
import type { Scope } from "../../domain/scope";
import { NotFoundError } from "../../errors/not-found-error";

/**
 * Shared bulk-delete logic for wiping a collection's entries and schema
 * within one scope. Callers are responsible for authorization checks and
 * holding the write mutex — this class performs no locking of its own.
 */
export class CollectionEraser {
  static async erase(store: Storage, scope: Scope, collection: string): Promise<void> {
    while (true) {
      const { items } = await store.list(scope, collection, { limit: 500, offset: 0 });
      if (items.length === 0) {
        break;
      }
      for (const entry of items) {
        await store.delete(scope, collection, entry.id);
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
  }
}
