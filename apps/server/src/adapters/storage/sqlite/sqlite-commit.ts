import type { SqliteConnection } from "./sqlite-connection";
import { CommitPreconditions } from "../../../core/domain/commit-preconditions";
import { CommitConflictError } from "../../../core/errors/commit-conflict-error";
import type { ChangeSet } from "../../../core/ports/change-set";
import type { CommitPrecondition } from "../../../core/ports/commit-precondition";
import type { CommitWrite } from "../../../core/ports/commit-write";
import type { SqliteCollectionStore } from "./sqlite-collection-store";
import type { SqliteEntryStore } from "./sqlite-entry-store";
import type { SqliteScopeResolver } from "./sqlite-scope-resolver";

/**
 * `AtomicStorage.commit` for SQLite (D107).
 *
 * One synchronous transaction: bun:sqlite turns the stores' own transactions
 * into savepoints inside it, and nothing else can run on this thread until it
 * ends. The read worker's connection sees the state before or after it (WAL).
 */
export class SqliteCommit {
  private readonly database: SqliteConnection;
  private readonly resolver: SqliteScopeResolver;
  private readonly collections: SqliteCollectionStore;
  private readonly entries: SqliteEntryStore;

  constructor(
    database: SqliteConnection,
    resolver: SqliteScopeResolver,
    collections: SqliteCollectionStore,
    entries: SqliteEntryStore
  ) {
    this.database = database;
    this.resolver = resolver;
    this.collections = collections;
    this.entries = entries;
  }

  apply(changes: ChangeSet): void {
    this.resolver.clear();
    try {
      this.database.transaction(() => {
        const conflicts = changes.preconditions.filter((precondition) => !this.holds(precondition));
        if (conflicts.length > 0) throw new CommitConflictError(conflicts);
        for (const write of changes.writes) this.write(write);
      })();
    } finally {
      // A rolled-back write may have cached an id that no longer exists.
      this.resolver.clear();
    }
  }

  private holds(precondition: CommitPrecondition): boolean {
    const { project, env } = precondition.scope;
    const collectionId = this.resolver.collectionIdIn(project, env, precondition.collection);

    if (precondition.kind === "entry") {
      if (collectionId === null) return precondition.seq === null;
      const row = this.database
        .query(`SELECT seq FROM entries WHERE collection_id = ? AND id = ?`)
        .get(collectionId, precondition.id) as { seq: number } | undefined;
      return (row ? row.seq : null) === precondition.seq;
    }

    if (precondition.kind === "collection") {
      const record = this.collections.find(precondition.scope, precondition.collection);
      return CommitPreconditions.recordHolds(
        precondition.record,
        record && { id: record.id, updatedAt: record.updated_at.toISOString() }
      );
    }

    const rows =
      collectionId === null
        ? []
        : (this.database
            .query(`SELECT id, seq FROM entries WHERE collection_id = ?`)
            .all(collectionId) as { id: string; seq: number }[]);
    return CommitPreconditions.rowsHold(precondition.rows, rows);
  }

  private write(write: CommitWrite): void {
    if (write.kind === "schema") {
      this.collections.put(write.scope, write.collection, write.schema, write.id);
    } else if (write.kind === "put") {
      this.entries.put(write.entry, write.derived);
    } else {
      this.entries.delete(write.scope, write.collection, write.id);
    }
  }
}
