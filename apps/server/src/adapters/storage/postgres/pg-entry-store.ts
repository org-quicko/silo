import type { Entry } from "../../../core/domain/entry";
import { EntryUtils } from "../../../core/domain/entry-utils";
import { PortableData } from "../../../core/domain/portable-data";
import type { Scope } from "../../../core/domain/scope";
import { NotFoundError } from "../../../core/errors/not-found-error";
import type { DerivedIndex } from "../../../core/ports/derived-index";
import type { Query } from "../../../core/query/query";
import { PgCompiler } from "./pg-compiler";
import type { PgConnection } from "./pg-connection";
import type { PgMediaReferenceStore } from "./pg-media-reference-store";
import type { PgMetaStore } from "./pg-meta-store";
import { PgParams } from "./pg-params";
import type { PgQueryable } from "./pg-queryable";
import { PgRowMapper } from "./pg-row-mapper";
import type { PgScanGate } from "./pg-scan-gate";
import type { PgSearchDocumentStore } from "./pg-search-document-store";
import type { PgScopeResolver } from "./pg-scope-resolver";
import type { PgTables } from "./pg-tables";

/**
 * The `entries` table, and everything keyed by an entry. The segment checks
 * and the addressing are `SqliteEntryStore`'s.
 */
export class PgEntryStore {
  /** Matches the default page size the Query AST normalises to. */
  private static readonly FallbackLimit = 50;

  private readonly connection: PgConnection;
  private readonly tables: PgTables;
  private readonly meta: PgMetaStore;
  private readonly mediaReferences: PgMediaReferenceStore;
  private readonly resolver: PgScopeResolver;
  private readonly scans: PgScanGate;
  private readonly searchDocuments: PgSearchDocumentStore;

  constructor(
    connection: PgConnection,
    tables: PgTables,
    meta: PgMetaStore,
    mediaReferences: PgMediaReferenceStore,
    resolver: PgScopeResolver,
    scans: PgScanGate,
    searchDocuments: PgSearchDocumentStore
  ) {
    this.scans = scans;
    this.searchDocuments = searchDocuments;
    this.connection = connection;
    this.tables = tables;
    this.meta = meta;
    this.mediaReferences = mediaReferences;
    this.resolver = resolver;
  }

  /**
   * The entry, its media references and its search row, in one transaction. The collection
   * has to exist (D51); one deleted between the lookup and the insert is
   * caught by the foreign key and reported as not found.
   *
   * `created_at` is not in the update list, so an overwrite keeps the first
   * write's (D92). The new `seq` is written back onto `entry` once the
   * transaction commits, as the other adapters do.
   */
  async put(entry: Entry, derived: DerivedIndex): Promise<void> {
    EntryUtils.assertSafeSegment(entry.project, "project");
    EntryUtils.assertSafeSegment(entry.env, "env");
    EntryUtils.assertSafeSegment(entry.collection, "collection");
    EntryUtils.assertSafeSegment(entry.id, "id");
    PortableData.assert(entry.data);

    const address = await this.resolver.requireCollectionIn(
      entry.project,
      entry.env,
      entry.collection
    );
    const document = JSON.stringify(entry.data);

    entry.seq = await this.connection.transaction(async (transaction) => {
      const seq = await this.meta.nextSeq(transaction);
      await transaction.query(
        `INSERT INTO ${this.tables.entries}
           (id, project_id, env_id, collection_id, rev, seq, created_at, updated_at, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb)
         ON CONFLICT (collection_id, id) DO UPDATE SET
           rev = excluded.rev,
           seq = excluded.seq,
           updated_at = excluded.updated_at,
           data = excluded.data`,
        [
          entry.id,
          address.projectId,
          address.envId,
          address.collectionId,
          entry.rev,
          seq,
          PgRowMapper.isoDate(entry.created_at),
          PgRowMapper.isoDate(entry.updated_at),
          document,
        ]
      );
      await this.mediaReferences.replaceForEntry(transaction, address, entry.id, derived.usages);
      await this.searchDocuments.write(transaction, address, entry.id, derived.search);
      return seq;
    });
  }

  async get(scope: Scope, collection: string, id: string): Promise<Entry> {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    const collectionId = await this.resolver.collectionId(scope, collection);
    if (collectionId === null) throw PgEntryStore.notFound(scope, collection, id);

    const [row] = await this.connection.query(
      `SELECT ${PgRowMapper.Columns} FROM ${this.tables.entries}
       WHERE collection_id = $1 AND id = $2`,
      [collectionId, id]
    );
    if (!row) throw PgEntryStore.notFound(scope, collection, id);
    return PgRowMapper.toScopedEntry(row, scope, collection);
  }

  /** The media references go with it, through the cascade. */
  async delete(scope: Scope, collection: string, id: string): Promise<void> {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    const collectionId = await this.resolver.collectionId(scope, collection);
    if (collectionId === null) throw PgEntryStore.notFound(scope, collection, id);

    // In a transaction, one statement though it is, so a connection that broke
    // before the delete ran is retried rather than answered as a 503.
    const removed = await this.connection.transaction((transaction) =>
      transaction.query(
        `DELETE FROM ${this.tables.entries} WHERE collection_id = $1 AND id = $2 RETURNING id`,
        [collectionId, id]
      )
    );
    if (removed.length === 0) throw PgEntryStore.notFound(scope, collection, id);
  }

  /**
   * A page and its total from one statement, so both come from one snapshot
   * and one round trip. The count is a subquery beside the page, which leaves
   * it unknown only when the page is empty; past the last page it is then
   * asked for on its own.
   *
   * Both run through the scan gate: a filter or a sort over `data`, and the
   * count, read the whole collection, and the gate keeps two connections free
   * for writes however many of these arrive.
   */
  async list(
    scope: Scope,
    collection: string,
    query: Query
  ): Promise<{ items: Entry[]; total: number }> {
    EntryUtils.assertSafeSegment(collection, "collection");

    const collectionId = await this.resolver.collectionId(scope, collection);
    if (collectionId === null) return { items: [], total: 0 };

    const params = new PgParams();
    let where = `collection_id = ${params.add(collectionId)}`;
    if (query.filter) where += ` AND (${PgCompiler.buildFilter(query.filter, params)})`;
    const order = PgCompiler.buildOrder(query.sort || [], params);
    const limit = query.limit > 0 ? Math.floor(query.limit) : PgEntryStore.FallbackLimit;
    const offset = Math.max(Math.floor(query.offset) || 0, 0);

    return this.scans.run(async () => {
      const rows = await this.connection.query(
        `SELECT (SELECT count(*) FROM ${this.tables.entries} WHERE ${where}) AS total,
                ${PgRowMapper.Columns}
         FROM ${this.tables.entries}
         WHERE ${where}
         ORDER BY ${order}
         LIMIT ${limit} OFFSET ${offset}`,
        params.values
      );

      let total = rows.length > 0 ? Number(rows[0].total) : 0;
      if (rows.length === 0 && offset > 0) {
        const [counted] = await this.connection.query<{ total: string }>(
          `SELECT count(*) AS total FROM ${this.tables.entries} WHERE ${where}`,
          params.values
        );
        total = Number(counted.total);
      }

      return {
        items: rows.map((row) => PgRowMapper.toScopedEntry(row, scope, collection)),
        total,
      };
    });
  }

  /** Collection **names** that hold at least one entry, in codepoint order. */
  async listCollections(scope: Scope): Promise<string[]> {
    const envId = await this.resolver.environmentId(scope.project, scope.env);
    if (envId === null) return [];

    const rows = await this.connection.query<{ name: string }>(
      `SELECT c.name AS name FROM ${this.tables.collections} c
       WHERE c.env_id = $1
         AND EXISTS (SELECT 1 FROM ${this.tables.entries} e WHERE e.collection_id = c.id)
       ORDER BY c.name`,
      [envId]
    );
    return rows.map((row) => row.name);
  }

  /** One `GROUP BY` for the whole scope. */
  async countEntries(scope: Scope): Promise<Map<string, number>> {
    const envId = await this.resolver.environmentId(scope.project, scope.env);
    if (envId === null) return new Map();

    const rows = await this.connection.query<{ name: string; total: string }>(
      `SELECT c.name AS name, count(*) AS total
       FROM ${this.tables.entries} e JOIN ${this.tables.collections} c ON c.id = e.collection_id
       WHERE e.env_id = $1
       GROUP BY c.name`,
      [envId]
    );
    return new Map(rows.map((row) => [row.name, Number(row.total)]));
  }

  /** Called from inside `PgScopeStore`'s delete transaction, by record id. */
  async purgeProject(transaction: PgQueryable, projectId: string): Promise<void> {
    await transaction.query(`DELETE FROM ${this.tables.entries} WHERE project_id = $1`, [projectId]);
  }

  /** Called from inside `PgScopeStore`'s delete transaction, by record id. */
  async purgeEnvironment(transaction: PgQueryable, envId: string): Promise<void> {
    await transaction.query(`DELETE FROM ${this.tables.entries} WHERE env_id = $1`, [envId]);
  }

  private static notFound(scope: Scope, collection: string, id: string): NotFoundError {
    return new NotFoundError(`entry ${scope.key()}/${collection}/${id} not found`);
  }
}
