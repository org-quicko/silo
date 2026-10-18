import { SchemaShape } from "@silo/shared/schema-shape";
import { ValidationError } from "@silo/shared/validation-error";
import { ConflictError } from "../errors/conflict-error";
import { NotFoundError } from "../errors/not-found-error";
import type { Scope } from "../domain/scope";
import type { Storage } from "../ports/storage";
import { MaxLimit } from "../query/query";
import { CollectionSchemas } from "./collection-schemas";
import { SchemaValidator } from "./schema-validator";

/**
 * The rule that a collection's entries always satisfy its schema (D70).
 *
 * `assertEntriesFit` is the rule for an author's save: a change of shape is
 * admitted when every stored entry satisfies it. `assert` is the stricter rule
 * imports and transfer plans still keep: no change of shape while the
 * collection holds entries at all.
 *
 * Silo used to validate on write only and let a schema change whenever: an
 * entry stored yesterday could stop satisfying the schema it is filed under,
 * and nothing said so. The collection then held data its own schema rejects,
 * which makes "validated on the way in" a claim about the moment of writing
 * rather than about the collection — and a client reading the schema to
 * generate types gets types the data does not fit.
 *
 * Neither rule rewrites an entry: a schema the data does not fit is refused,
 * and the migration path is the one silo already has — export, transform,
 * import into a fresh collection.
 *
 * Only the **validating shape** is checked (`SchemaShape`), so access, search
 * configuration and labels stay editable on a populated collection.
 *
 * Every writer of a stored schema reaches it here: `CollectionService.putSchema`
 * for the API, the admin and MCP, and `Importer` and `TransferPlanner` for an
 * archive, a scope copy or a transfer. A rename does not — `SchemaRefRewrite`
 * repoints `$ref`s at a collection that changed name, which renames the
 * constraints without changing them.
 */
export class SchemaChangeGuard {
  /**
   * Throws `ConflictError` if `incoming` would change what validates in a
   * collection that already holds entries.
   *
   * Call it **under the write lock**. The check is a read followed by a write,
   * so outside the lock an entry created in between would land in a collection
   * whose schema had already moved.
   *
   * `incoming` must be the **bundled** document, because that is what the
   * validator compiles: a `$defs` entry embedded from a referenced collection
   * constrains entries exactly as a locally declared one does. A referenced
   * collection that changed since this one was last saved therefore counts as
   * a change here, which is honest — the constraints really did move — even
   * though the author edited nothing.
   */
  static async assert(
    store: Storage,
    scope: Scope,
    collection: string,
    incoming: unknown
  ): Promise<void> {
    let current: unknown;
    try {
      current = await store.getSchema(scope, collection);
    } catch (caught) {
      // No collection yet, so there is nothing to invalidate and no count to
      // take. Creation is always allowed.
      if (caught instanceof NotFoundError) return;
      throw caught;
    }

    if (SchemaShape.same(current, incoming)) return;

    const { total } = await store.list(scope, collection, { limit: 1, offset: 0 });
    if (total === 0) return;

    throw new ConflictError(
      `collection "${collection}" has ${total} ${total === 1 ? "entry" : "entries"}: ` +
        `its schema cannot change while they exist, because they were validated against ` +
        `the current one. Delete the entries, or export them and import into a new ` +
        `collection. Access, search fields and labels can still be edited.`
    );
  }

  /**
   * Throws `ConflictError` if `incoming` would change what validates in a
   * collection holding an entry that `incoming` refuses. Stops at the first
   * such entry, so the message names no entry and no count.
   *
   * Call it **under the write lock**, with the **bundled** document, for the
   * reasons `assert` gives; the lock is also what keeps the offset paging from
   * skipping or repeating an entry. `allowRemoteRefs` is the instance's
   * setting, as `SchemaValidator` takes it.
   */
  static async assertEntriesFit(
    store: Storage,
    scope: Scope,
    collection: string,
    incoming: unknown,
    allowRemoteRefs: boolean
  ): Promise<void> {
    const record = await store.findCollection(scope, collection);
    if (!record || SchemaShape.same(record.schema, incoming)) return;

    // A fresh validator per check: its compiled schema is cached by
    // collection name, not by document, so a shared one would judge a second
    // attempt with the first attempt's schema.
    const validator = new SchemaValidator(store, { allowRemoteRefs });
    const schemas = CollectionSchemas.map(await store.listCollections(scope));
    schemas.set(collection, incoming);

    for (let offset = 0; ; offset += MaxLimit) {
      const { items } = await store.list(scope, collection, { limit: MaxLimit, offset });
      for (const entry of items) {
        try {
          await validator.validateEntryAgainst(schemas, scope, collection, entry.data);
        } catch (caught) {
          if (!(caught instanceof ValidationError)) throw caught;
          throw new ConflictError(
            `collection "${collection}" has entries that do not match the new schema, ` +
              `so it was not saved. Access, search fields and labels can still be edited.`
          );
        }
      }
      if (items.length < MaxLimit) return;
    }
  }
}
