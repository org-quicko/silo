import type { CollectionRecord } from "../../../core/domain/collection-record";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { Scope } from "../../../core/domain/scope";
import { ConflictError } from "../../../core/errors/conflict-error";
import { NotFoundError } from "../../../core/errors/not-found-error";
import type { PgConnection } from "./pg-connection";
import { PgIdClaim } from "./pg-id-claim";
import type { PgQueryable } from "./pg-queryable";
import { PgRecordMapper } from "./pg-record-mapper";
import type { PgScopeResolver } from "./pg-scope-resolver";
import type { PgScopeStore } from "./pg-scope-store";
import type { PgTables } from "./pg-tables";

/**
 * The `collections` table: one keyed record per collection, holding its schema
 * (D51). The rules are `SqliteCollectionStore`'s.
 *
 * The schema is stored as the text `JSON.stringify` made, not as `jsonb`, so
 * it comes back with its keys in the order they were written: that order is
 * the admin form's field order.
 */
export class PgCollectionStore {
  private readonly connection: PgConnection;
  private readonly tables: PgTables;
  private readonly resolver: PgScopeResolver;
  private readonly scopes: PgScopeStore;

  constructor(
    connection: PgConnection,
    tables: PgTables,
    resolver: PgScopeResolver,
    scopes: PgScopeStore
  ) {
    this.connection = connection;
    this.tables = tables;
    this.resolver = resolver;
    this.scopes = scopes;
  }

  /**
   * Creates the record, or replaces the schema on the one already there,
   * keeping its id. A create that loses a race to the same name becomes an
   * update of the winner's record, which is what the sequential order would
   * have done.
   */
  async put(scope: Scope, collection: string, schema: any, id?: string): Promise<CollectionRecord> {
    EntryUtils.assertSafeSegment(collection, "collection");
    const document = JSON.stringify(schema);

    return this.resolver.invalidating(() =>
      this.connection.transaction(async (transaction) => {
        const { projectId, envId } = await this.scopes.ensureScope(transaction, scope);
        const now = EntryUtils.now().toISOString();

        const existing = await this.read(transaction, envId, collection);
        const recordId = existing
          ? existing.id
          : await PgIdClaim.claim(transaction, this.tables, id, "collection");

        const [row] = await transaction.query(
          `INSERT INTO ${this.tables.collections}
             (id, project_id, env_id, name, schema, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT (env_id, name) DO UPDATE SET
             schema = excluded.schema,
             updated_at = excluded.updated_at
           RETURNING ${PgRecordMapper.CollectionColumns}`,
          [recordId, projectId, envId, collection, document, now]
        );
        return { ...PgRecordMapper.toCollection(row), schema };
      })
    );
  }

  async get(scope: Scope, collection: string): Promise<any> {
    const record = await this.find(scope, collection);
    if (!record) throw PgCollectionStore.notFound(scope, collection);
    return record.schema;
  }

  async list(scope: Scope): Promise<CollectionRecord[]> {
    const envId = await this.resolver.environmentId(scope.project, scope.env);
    if (envId === null) return [];

    const rows = await this.connection.query(
      `SELECT ${PgRecordMapper.CollectionColumns} FROM ${this.tables.collections}
       WHERE env_id = $1 ORDER BY name`,
      [envId]
    );
    return rows.map(PgRecordMapper.toCollection);
  }

  async find(scope: Scope, collection: string): Promise<CollectionRecord | null> {
    const envId = await this.resolver.environmentId(scope.project, scope.env);
    return envId === null ? null : this.read(this.connection, envId, collection);
  }

  async rename(id: string, name: string): Promise<void> {
    EntryUtils.assertSafeSegment(name, "collection");

    await this.resolver.invalidating(() =>
      this.connection.transaction(async (transaction) => {
        const [current] = await transaction.query(
          `SELECT env_id, name FROM ${this.tables.collections} WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (!current) throw PgRecordMapper.noSuchRecord("collection", id);
        if (current.name === name) return;

        if (await this.read(transaction, current.env_id, name)) {
          throw new ConflictError(`collection "${name}" already exists in this environment`);
        }
        await transaction.query(
          `UPDATE ${this.tables.collections} SET name = $1, updated_at = $2 WHERE id = $3`,
          [name, EntryUtils.now().toISOString(), id]
        );
      })
    );
  }

  /**
   * Removes the record, which is the whole collection. Entries have to be gone
   * first; the count is taken here so the refusal names what is in the way,
   * and the foreign key still refuses an entry written after the count.
   */
  async delete(scope: Scope, collection: string): Promise<void> {
    await this.resolver.invalidating(() =>
      this.connection.transaction(async (transaction) => {
        const envId = await this.resolver.environmentId(scope.project, scope.env);
        const record = envId === null ? null : await this.read(transaction, envId, collection);
        if (!record) throw PgCollectionStore.notFound(scope, collection);

        const [remaining] = await transaction.query<{ total: string }>(
          `SELECT count(*) AS total FROM ${this.tables.entries} WHERE collection_id = $1`,
          [record.id]
        );
        const total = Number(remaining.total);
        if (total > 0) {
          throw new ConflictError(
            `collection "${scope.key()}/${collection}" still holds ${total} entries`
          );
        }
        await transaction.query(`DELETE FROM ${this.tables.collections} WHERE id = $1`, [
          record.id,
        ]);
      })
    );
  }

  private async read(
    database: PgQueryable,
    envId: string,
    collection: string
  ): Promise<CollectionRecord | null> {
    const [row] = await database.query(
      `SELECT ${PgRecordMapper.CollectionColumns} FROM ${this.tables.collections}
       WHERE env_id = $1 AND name = $2`,
      [envId, collection]
    );
    return row ? PgRecordMapper.toCollection(row) : null;
  }

  private static notFound(scope: Scope, collection: string): NotFoundError {
    return new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
  }
}
