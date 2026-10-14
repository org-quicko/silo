import { CommitPreconditions } from "../../../core/domain/commit-preconditions";
import { CommitConflictError } from "../../../core/errors/commit-conflict-error";
import type { ChangeSet } from "../../../core/ports/change-set";
import type { CommitPrecondition } from "../../../core/ports/commit-precondition";
import type { CommitWrite } from "../../../core/ports/commit-write";
import type { PgCollectionStore } from "./pg-collection-store";
import type { PgConnection } from "./pg-connection";
import type { PgEntryStore } from "./pg-entry-store";
import type { PgQueryable } from "./pg-queryable";
import { PgScopeResolver } from "./pg-scope-resolver";
import type { PgTables } from "./pg-tables";

/**
 * `AtomicStorage.commit` for Postgres (D107).
 *
 * One transaction on one connection. Lookups inside it go through a resolver
 * of its own, so a collection the commit created is found and nothing it
 * looked up reaches the shared cache. `PgConnection.transaction` retries a
 * transaction that broke before it finished and never one that broke while
 * committing; that one surfaces as a `503` whose outcome is unknown.
 */
export class PgCommit {
  private readonly connection: PgConnection;
  private readonly tables: PgTables;
  private readonly resolver: PgScopeResolver;
  private readonly collections: PgCollectionStore;
  private readonly entries: PgEntryStore;

  constructor(
    connection: PgConnection,
    tables: PgTables,
    resolver: PgScopeResolver,
    collections: PgCollectionStore,
    entries: PgEntryStore
  ) {
    this.connection = connection;
    this.tables = tables;
    this.resolver = resolver;
    this.collections = collections;
    this.entries = entries;
  }

  async apply(changes: ChangeSet): Promise<void> {
    await this.resolver.invalidating(() =>
      this.connection.transaction(async (transaction) => {
        const resolver = new PgScopeResolver(transaction, this.tables);
        const conflicts: CommitPrecondition[] = [];
        for (const precondition of changes.preconditions) {
          if (!(await this.holds(transaction, resolver, precondition))) conflicts.push(precondition);
        }
        if (conflicts.length > 0) throw new CommitConflictError(conflicts);
        for (const write of changes.writes) await this.write(transaction, resolver, write);
      })
    );
  }

  private async holds(
    transaction: PgQueryable,
    resolver: PgScopeResolver,
    precondition: CommitPrecondition
  ): Promise<boolean> {
    const { project, env } = precondition.scope;
    const collectionId = await resolver.collectionIdIn(project, env, precondition.collection);

    if (precondition.kind === "entry") {
      const seq =
        collectionId === null ? null : await this.entries.seqIn(transaction, collectionId, precondition.id);
      return seq === precondition.seq;
    }

    if (precondition.kind === "collection") {
      const record = await this.collections.findIn(
        transaction,
        resolver,
        precondition.scope,
        precondition.collection
      );
      return CommitPreconditions.recordHolds(
        precondition.record,
        record && { id: record.id, updatedAt: record.updated_at.toISOString() }
      );
    }

    const rows = collectionId === null ? [] : await this.entries.rowsIn(transaction, collectionId);
    return CommitPreconditions.rowsHold(precondition.rows, rows);
  }

  private async write(
    transaction: PgQueryable,
    resolver: PgScopeResolver,
    write: CommitWrite
  ): Promise<void> {
    if (write.kind === "schema") {
      await this.collections.putIn(transaction, write.scope, write.collection, write.schema, write.id);
      // It may have created the project, the environment and the collection.
      resolver.clear();
    } else if (write.kind === "put") {
      write.entry.seq = await this.entries.putIn(transaction, resolver, write.entry, write.derived);
    } else {
      await this.entries.deleteIn(transaction, resolver, write.scope, write.collection, write.id);
    }
  }
}
