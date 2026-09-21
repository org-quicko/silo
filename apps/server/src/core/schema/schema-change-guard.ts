import { SchemaShape } from "@silo/shared/schema-shape";
import { ConflictError } from "../errors/conflict-error";
import { NotFoundError } from "../errors/not-found-error";
import type { Scope } from "../domain/scope";
import type { Storage } from "../ports/storage";

/**
 * The rule that a collection's constraints are frozen once it holds entries
 * (D70).
 *
 * Silo used to validate on write only and let a schema change whenever: an
 * entry stored yesterday could stop satisfying the schema it is filed under,
 * and nothing said so. The collection then held data its own schema rejects,
 * which makes "validated on the way in" a claim about the moment of writing
 * rather than about the collection — and a client reading the schema to
 * generate types gets types the data does not fit.
 *
 * Freezing the schema rather than rewriting or re-checking the entries is the
 * cheap half of the guarantee: one count instead of a sweep of the collection,
 * and no write that edits data the author did not ask to touch. The migration
 * path is the one silo already has — export, transform, import into a fresh
 * collection.
 *
 * Only the **validating shape** is frozen (`SchemaShape`), so access, search
 * configuration and labels stay editable on a populated collection.
 *
 * Both writers of a stored schema reach it here: `CollectionService.putSchema`
 * for the API and the admin, and `Importer` for an archive or a scope copy.
 * A rename does not — `SchemaRefRewrite` repoints `$ref`s at a collection that
 * changed name, which renames the constraints without changing them.
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
}
