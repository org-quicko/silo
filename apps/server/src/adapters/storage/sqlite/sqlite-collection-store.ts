import type { SqliteConnection } from "./sqlite-connection";
import type { CollectionRecord } from "../../../core/domain/collection-record";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { Scope } from "../../../core/domain/scope";
import { ConflictError } from "../../../core/errors/conflict-error";
import { NotFoundError } from "../../../core/errors/not-found-error";
import { SqliteIdClaim } from "./sqlite-id-claim";
import { SqliteRecordMapper } from "./sqlite-record-mapper";
import type { SqliteScopeResolver } from "./sqlite-scope-resolver";
import type { SqliteScopeStore } from "./sqlite-scope-store";

/**
 * The `collections` table: one keyed record per collection, holding its schema
 * (D51). It replaced the `schemas` table rather than joining it, so nothing has
 * two answers to whether a collection exists.
 */
export class SqliteCollectionStore {
  private readonly database: SqliteConnection;
  private readonly resolver: SqliteScopeResolver;
  private readonly scopes: SqliteScopeStore;

  constructor(database: SqliteConnection, resolver: SqliteScopeResolver, scopes: SqliteScopeStore) {
    this.database = database;
    this.resolver = resolver;
    this.scopes = scopes;
  }

  /**
   * Creates the record, or replaces the schema on the one that is already
   * there — **keeping its id**, which is what makes a re-put a schema edit
   * rather than a new collection wearing the same name.
   *
   * The scope is created if missing, since a project and an environment are
   * pure containers and creating one implicitly needs nothing the caller has
   * not supplied.
   */
  put(scope: Scope, collection: string, schema: any, id?: string): CollectionRecord {
    EntryUtils.assertSafeSegment(collection, "collection");

    let record!: CollectionRecord;
    this.database.transaction(() => {
      const { projectId, envId } = this.scopes.ensureScope(scope);
      const now = EntryUtils.now().toISOString();
      const document = JSON.stringify(schema);

      const existing = this.read(envId, collection);
      if (existing) {
        this.database
          .query(`UPDATE collections SET schema = ?, updated_at = ? WHERE id = ?`)
          .run(document, now, existing.id);
        record = { ...existing, schema, updated_at: new Date(now) };
        return;
      }

      const recordId = SqliteIdClaim.claim(this.database, id, "collection");
      this.database
        .query(
          `INSERT INTO collections
             (id, project_id, env_id, name, schema, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(recordId, projectId, envId, collection, document, now, now);
      record = {
        id: recordId,
        project_id: projectId,
        env_id: envId,
        name: collection,
        schema,
        created_at: new Date(now),
        updated_at: new Date(now),
      };
    })();
    this.resolver.clear();

    return record;
  }

  get(scope: Scope, collection: string): any {
    const record = this.find(scope, collection);
    if (!record) throw SqliteCollectionStore.notFound(scope, collection);
    return record.schema;
  }

  list(scope: Scope): CollectionRecord[] {
    const envId = this.resolver.environmentId(scope.project, scope.env);
    if (envId === null) return [];

    const rows = this.database
      .query(`${SqliteCollectionStore.Select} WHERE env_id = ? ORDER BY name`)
      .all(envId) as any[];
    return rows.map(SqliteRecordMapper.toCollection);
  }

  find(scope: Scope, collection: string): CollectionRecord | null {
    const envId = this.resolver.environmentId(scope.project, scope.env);
    return envId === null ? null : this.read(envId, collection);
  }

  rename(id: string, name: string): void {
    EntryUtils.assertSafeSegment(name, "collection");

    this.database.transaction(() => {
      const current = this.readById(id);
      if (current.name === name) return;

      if (this.read(current.env_id, name)) {
        throw new ConflictError(`collection "${name}" already exists in this environment`);
      }
      this.database
        .query(`UPDATE collections SET name = ?, updated_at = ? WHERE id = ?`)
        .run(name, EntryUtils.now().toISOString(), id);
    })();
    this.resolver.clear();
  }

  /**
   * Removes the record, which is the whole collection: the schema is not a
   * nullable field that could be cleared while the collection survived.
   *
   * Entries have to be gone first. The foreign key would refuse this anyway,
   * but as a raw constraint failure naming neither the collection nor the
   * count, so the check is made here to say what is actually in the way.
   */
  delete(scope: Scope, collection: string): void {
    this.database.transaction(() => {
      const record = this.find(scope, collection);
      if (!record) throw SqliteCollectionStore.notFound(scope, collection);

      const remaining = this.database
        .query(`SELECT COUNT(*) AS total FROM entries WHERE collection_id = ?`)
        .get(record.id) as { total: number };
      if (remaining.total > 0) {
        throw new ConflictError(
          `collection "${scope.key()}/${collection}" still holds ${remaining.total} entries`
        );
      }
      this.database.query(`DELETE FROM collections WHERE id = ?`).run(record.id);
    })();
    this.resolver.clear();
  }

  private static readonly Select =
    "SELECT id, project_id, env_id, name, schema, created_at, updated_at FROM collections";

  private read(envId: string, collection: string): CollectionRecord | null {
    const row = this.database
      .query(`${SqliteCollectionStore.Select} WHERE env_id = ? AND name = ?`)
      .get(envId, collection) as any;
    return row ? SqliteRecordMapper.toCollection(row) : null;
  }

  private readById(id: string): CollectionRecord {
    const row = this.database
      .query(`${SqliteCollectionStore.Select} WHERE id = ?`)
      .get(id) as any;
    if (!row) throw SqliteRecordMapper.noSuchRecord("collection", id);
    return SqliteRecordMapper.toCollection(row);
  }

  private static notFound(scope: Scope, collection: string): NotFoundError {
    return new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
  }
}
