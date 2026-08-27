import type { Database } from "bun:sqlite";
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
import type { SqliteSearchDocumentStore } from "./sqlite-search-document-store";

/**
 * The `entries` table, and everything keyed by an entry.
 *
 * `collection`/`id` (and `project`/`env` on write) are validated as safe path
 * segments even though SQLite has no filesystem to escape — it is a `Storage`
 * port contract both adapters enforce identically, so an import archive cannot
 * plant a malformed id that behaves differently depending on which adapter is
 * running.
 */
export class SqliteEntryStore {
  /** Matches the default page size the Query AST normalises to. */
  private static readonly FallbackLimit = 50;

  private static readonly Columns =
    "id, project, env, collection, rev, seq, created_at, updated_at, data";

  private readonly database: Database;
  private readonly meta: SqliteMetaStore;
  private readonly mediaReferences: SqliteMediaReferenceStore;
  private readonly searchDocuments: SqliteSearchDocumentStore;

  constructor(
    database: Database,
    meta: SqliteMetaStore,
    mediaReferences: SqliteMediaReferenceStore,
    searchDocuments: SqliteSearchDocumentStore
  ) {
    this.database = database;
    this.meta = meta;
    this.mediaReferences = mediaReferences;
    this.searchDocuments = searchDocuments;
  }

  /** The entry, its media references and its index document, in one
   *  transaction. */
  put(entry: Entry, derived: DerivedIndex): void {
    EntryUtils.assertSafeSegment(entry.project, "project");
    EntryUtils.assertSafeSegment(entry.env, "env");
    EntryUtils.assertSafeSegment(entry.collection, "collection");
    EntryUtils.assertSafeSegment(entry.id, "id");

    this.database.transaction(() => {
      entry.seq = this.meta.nextSeq();

      this.database
        .prepare(
          `INSERT INTO entries (${SqliteEntryStore.Columns})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (project, env, collection, id) DO UPDATE SET
             rev = excluded.rev,
             seq = excluded.seq,
             updated_at = excluded.updated_at,
             data = excluded.data`
        )
        .run(
          entry.id,
          entry.project,
          entry.env,
          entry.collection,
          entry.rev,
          entry.seq,
          SqliteRowMapper.isoDate(entry.created_at),
          SqliteRowMapper.isoDate(entry.updated_at),
          JSON.stringify(entry.data)
        );

      this.mediaReferences.replaceForEntry(entry, derived.usages);
      this.searchDocuments.write(
        entry.project,
        entry.env,
        entry.collection,
        entry.id,
        derived.search
      );
    })();
  }

  get(scope: Scope, collection: string, id: string): Entry {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    const row = this.database
      .prepare(
        `SELECT ${SqliteEntryStore.Columns} FROM entries
         WHERE project = ? AND env = ? AND collection = ? AND id = ?`
      )
      .get(scope.project, scope.env, collection, id) as any;

    if (!row) throw SqliteEntryStore.notFound(scope, collection, id);
    return SqliteRowMapper.toEntry(row);
  }

  delete(scope: Scope, collection: string, id: string): void {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    let changes = 0;
    this.database.transaction(() => {
      changes = this.database
        .prepare(
          `DELETE FROM entries WHERE project = ? AND env = ? AND collection = ? AND id = ?`
        )
        .run(scope.project, scope.env, collection, id).changes;
      if (changes === 0) return;

      this.mediaReferences.purgeEntry(scope.project, scope.env, collection, id);
      this.searchDocuments.purgeEntry(scope.project, scope.env, collection, id);
    })();

    if (changes === 0) throw SqliteEntryStore.notFound(scope, collection, id);
  }

  list(scope: Scope, collection: string, query: Query): { items: Entry[]; total: number } {
    EntryUtils.assertSafeSegment(collection, "collection");

    let where = "project = ? AND env = ? AND collection = ?";
    const whereArgs: any[] = [scope.project, scope.env, collection];
    if (query.filter) {
      const { cond, args } = SqliteCompiler.buildFilter(query.filter);
      where += ` AND (${cond})`;
      whereArgs.push(...args);
    }

    const countRow = this.database
      .prepare(`SELECT COUNT(*) as total FROM entries WHERE ${where}`)
      .get(...whereArgs) as { total: number } | undefined;
    const total = countRow ? countRow.total : 0;

    const { order, args: orderArgs } = SqliteCompiler.buildOrder(query.sort || []);
    const limit = query.limit > 0 ? query.limit : SqliteEntryStore.FallbackLimit;
    const offset = Math.max(query.offset, 0);

    const rows = this.database
      .prepare(
        `SELECT ${SqliteEntryStore.Columns} FROM entries
         WHERE ${where}
         ORDER BY ${order}
         LIMIT ? OFFSET ?`
      )
      .all(...whereArgs, ...orderArgs, limit, offset) as any[];

    return { items: rows.map((row) => SqliteRowMapper.toEntry(row)), total };
  }

  listCollections(scope: Scope): string[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT collection FROM entries
         WHERE project = ? AND env = ?
         ORDER BY collection`
      )
      .all(scope.project, scope.env) as { collection: string }[];
    return rows.map((row) => row.collection);
  }

  /** Called from inside `SqliteScopeStore`'s delete transaction. */
  purgeProject(project: string): void {
    this.database.prepare(`DELETE FROM entries WHERE project = ?`).run(project);
    this.mediaReferences.purgeProject(project);
    this.searchDocuments.purgeProject(project);
  }

  /** Called from inside `SqliteScopeStore`'s delete transaction. */
  purgeEnvironment(project: string, env: string): void {
    this.database
      .prepare(`DELETE FROM entries WHERE project = ? AND env = ?`)
      .run(project, env);
    this.mediaReferences.purgeEnvironment(project, env);
    this.searchDocuments.purgeEnvironment(project, env);
  }

  private static notFound(scope: Scope, collection: string, id: string): NotFoundError {
    return new NotFoundError(`entry ${scope.key()}/${collection}/${id} not found`);
  }
}
