import type { SqliteConnection } from "./sqlite-connection";
import type { Entry } from "../../../core/domain/entry";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { Scope } from "../../../core/domain/scope";
import { NotFoundError } from "../../../core/errors/not-found-error";
import type { DerivedIndex } from "../../../core/ports/derived-index";
import type { Query } from "../../../core/query/query";
import { SqliteCompiler } from "./sqlite-compiler";
import type { SqliteMediaReferenceStore } from "./sqlite-media-reference-store";
import type { SqliteMetaStore } from "./sqlite-meta-store";
import { SqliteRowMapper } from "./sqlite-row-mapper";
import type { SqliteScopeResolver } from "./sqlite-scope-resolver";
import type { SqliteSearchDocumentStore } from "./sqlite-search-document-store";

/**
 * The `entries` table, and everything keyed by an entry.
 *
 * `collection`/`id` (and `project`/`env` on write) are validated as safe path
 * segments even though SQLite has no filesystem to escape — it is a `Storage`
 * port contract both adapters enforce identically, so an import archive cannot
 * plant a malformed id that behaves differently depending on which adapter is
 * running.
 *
 * Rows are addressed by record id (D51) and the envelope's names come from the
 * caller, so a rename moves nothing here.
 */
export class SqliteEntryStore {
  /** Matches the default page size the Query AST normalises to. */
  private static readonly FallbackLimit = 50;

  private static readonly Columns = "id, rev, seq, created_at, updated_at, data";

  private readonly database: SqliteConnection;
  private readonly meta: SqliteMetaStore;
  private readonly mediaReferences: SqliteMediaReferenceStore;
  private readonly searchDocuments: SqliteSearchDocumentStore;
  private readonly resolver: SqliteScopeResolver;

  constructor(
    database: SqliteConnection,
    meta: SqliteMetaStore,
    mediaReferences: SqliteMediaReferenceStore,
    searchDocuments: SqliteSearchDocumentStore,
    resolver: SqliteScopeResolver
  ) {
    this.database = database;
    this.meta = meta;
    this.mediaReferences = mediaReferences;
    this.searchDocuments = searchDocuments;
    this.resolver = resolver;
  }

  /**
   * The entry, its media references and its index document, in one transaction.
   *
   * The collection has to exist. Its schema is `NOT NULL`, so nothing here
   * could create one — and an entry written into a collection with no schema is
   * precisely the state the invariant exists to prevent (D51). Projects and
   * environments are still created implicitly, by `putSchema`.
   */
  put(entry: Entry, derived: DerivedIndex): void {
    EntryUtils.assertSafeSegment(entry.project, "project");
    EntryUtils.assertSafeSegment(entry.env, "env");
    EntryUtils.assertSafeSegment(entry.collection, "collection");
    EntryUtils.assertSafeSegment(entry.id, "id");

    const address = this.resolver.requireCollectionIn(
      entry.project,
      entry.env,
      entry.collection
    );

    this.database.transaction(() => {
      entry.seq = this.meta.nextSeq();

      this.database
        .query(
          `INSERT INTO entries
             (id, project_id, env_id, collection_id, rev, seq, created_at, updated_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (collection_id, id) DO UPDATE SET
             rev = excluded.rev,
             seq = excluded.seq,
             updated_at = excluded.updated_at,
             data = excluded.data`
        )
        .run(
          entry.id,
          address.projectId,
          address.envId,
          address.collectionId,
          entry.rev,
          entry.seq,
          SqliteRowMapper.isoDate(entry.created_at),
          SqliteRowMapper.isoDate(entry.updated_at),
          JSON.stringify(entry.data)
        );

      this.mediaReferences.replaceForEntry(address, entry.id, derived.usages);
      this.searchDocuments.write(address, entry.id, derived.search);
    })();
  }

  get(scope: Scope, collection: string, id: string): Entry {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    const collectionId = this.resolver.collectionId(scope, collection);
    if (collectionId === null) throw SqliteEntryStore.notFound(scope, collection, id);

    const row = this.database
      .query(
        `SELECT ${SqliteEntryStore.Columns} FROM entries
         WHERE collection_id = ? AND id = ?`
      )
      .get(collectionId, id) as any;

    if (!row) throw SqliteEntryStore.notFound(scope, collection, id);
    return SqliteRowMapper.toScopedEntry(row, scope, collection);
  }

  /** The entry's media references and index row go with it, through the
   *  `ON DELETE CASCADE` those two tables declare. */
  delete(scope: Scope, collection: string, id: string): void {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    const collectionId = this.resolver.collectionId(scope, collection);
    if (collectionId === null) throw SqliteEntryStore.notFound(scope, collection, id);

    const changes = this.database
      .query(`DELETE FROM entries WHERE collection_id = ? AND id = ?`)
      .run(collectionId, id).changes;

    if (changes === 0) throw SqliteEntryStore.notFound(scope, collection, id);
  }

  list(scope: Scope, collection: string, query: Query): { items: Entry[]; total: number } {
    EntryUtils.assertSafeSegment(collection, "collection");

    const collectionId = this.resolver.collectionId(scope, collection);
    if (collectionId === null) return { items: [], total: 0 };

    let where = "collection_id = ?";
    const whereArgs: any[] = [collectionId];
    if (query.filter) {
      const { cond, args } = SqliteCompiler.buildFilter(query.filter);
      where += ` AND (${cond})`;
      whereArgs.push(...args);
    }

    const countRow = this.database.once(`SELECT COUNT(*) as total FROM entries WHERE ${where}`,
      (statement) => statement.get(...whereArgs)
    ) as { total: number } | undefined;
    const total = countRow ? countRow.total : 0;

    const { order, args: orderArgs } = SqliteCompiler.buildOrder(query.sort || []);
    const limit = query.limit > 0 ? query.limit : SqliteEntryStore.FallbackLimit;
    const offset = Math.max(query.offset, 0);

    const rows = this.database.once(`SELECT ${SqliteEntryStore.Columns} FROM entries
         WHERE ${where}
         ORDER BY ${order}
         LIMIT ? OFFSET ?`,
      (statement) => statement.all(...whereArgs, ...orderArgs, limit, offset)
    ) as any[];

    return {
      items: rows.map((row) => SqliteRowMapper.toScopedEntry(row, scope, collection)),
      total,
    };
  }

  /** Collection **names**, so the join to `collections` is what answers. */
  listCollections(scope: Scope): string[] {
    const envId = this.resolver.environmentId(scope.project, scope.env);
    if (envId === null) return [];

    const rows = this.database
      .query(
        `SELECT DISTINCT c.name AS name
         FROM entries e JOIN collections c ON c.id = e.collection_id
         WHERE e.env_id = ?
         ORDER BY c.name`
      )
      .all(envId) as { name: string }[];
    return rows.map((row) => row.name);
  }

  /** One `GROUP BY` for the whole scope, so a sidebar's counts are one query
   *  rather than one list request per collection. */
  countEntries(scope: Scope): Map<string, number> {
    const envId = this.resolver.environmentId(scope.project, scope.env);
    if (envId === null) return new Map();

    const rows = this.database
      .query(
        `SELECT c.name AS name, COUNT(*) AS total
         FROM entries e JOIN collections c ON c.id = e.collection_id
         WHERE e.env_id = ?
         GROUP BY c.name`
      )
      .all(envId) as { name: string; total: number }[];
    return new Map(rows.map((row) => [row.name, row.total]));
  }

  /** Called from inside `SqliteScopeStore`'s delete transaction, by record id. */
  purgeProject(projectId: string): void {
    this.database.query(`DELETE FROM entries WHERE project_id = ?`).run(projectId);
  }

  /** Called from inside `SqliteScopeStore`'s delete transaction, by record id. */
  purgeEnvironment(envId: string): void {
    this.database.query(`DELETE FROM entries WHERE env_id = ?`).run(envId);
  }

  private static notFound(scope: Scope, collection: string, id: string): NotFoundError {
    return new NotFoundError(`entry ${scope.key()}/${collection}/${id} not found`);
  }
}
