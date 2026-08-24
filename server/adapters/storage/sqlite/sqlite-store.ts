import { Database } from "bun:sqlite";
import fs from "fs/promises";
import path from "path";
import type { Storage } from "../../../core/ports/storage";
import type { DerivedIndex } from "../../../core/ports/derived-index";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { Entry } from "../../../core/domain/entry";
import type { Meta } from "../../../core/domain/meta";
import { Scope } from "../../../core/domain/scope";
import type { Query } from "../../../core/query/query";
import type { MediaUsage } from "../../../core/media/media-usage";
import { NotFoundError } from "../../../core/errors/not-found-error";
import { FormatVersion } from "../../../core/transfer/format-version";
import { SqliteCompiler } from "./sqlite-compiler";
import { SearchIndex, type SearchIndexOptions } from "./search-index";
import { SqliteSearcher } from "./sqlite-searcher";

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS environments (
  project    TEXT NOT NULL,
  id         TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project, id)
);
CREATE TABLE IF NOT EXISTS schemas (
  project    TEXT NOT NULL,
  env        TEXT NOT NULL,
  collection TEXT NOT NULL,
  schema     TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project, env, collection)
);
CREATE TABLE IF NOT EXISTS entries (
  id         TEXT NOT NULL,
  project    TEXT NOT NULL,
  env        TEXT NOT NULL,
  collection TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  seq        INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (project, env, collection, id)
);
CREATE INDEX IF NOT EXISTS idx_entries_seq ON entries(seq);
CREATE TABLE IF NOT EXISTS media_references (
  media_id   TEXT NOT NULL,
  project    TEXT NOT NULL,
  env        TEXT NOT NULL,
  collection TEXT NOT NULL,
  entry_id   TEXT NOT NULL,
  PRIMARY KEY (media_id, project, env, collection, entry_id)
);
CREATE INDEX IF NOT EXISTS idx_media_refs_entry ON media_references(project, env, collection, entry_id);
CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project);
`;

export class SqliteStore implements Storage {
  private db: Database;
  /**
   * False when search is switched off *or* this SQLite build has no FTS5. The
   * store then keeps no index and `createSearcher()` returns null, so the
   * caller falls back to the portable engine (D30).
   */
  private readonly indexing: boolean;
  /** Set when the index has to be refilled before it can answer anything. */
  private rebuildDue = false;

  private constructor(db: Database, indexing: boolean, rebuildDue: boolean) {
    this.db = db;
    this.indexing = indexing;
    this.rebuildDue = rebuildDue;
  }

  static async open(
    filePath: string,
    search: SearchIndexOptions = { enabled: true, tokenizer: "unicode61 remove_diacritics 2" }
  ): Promise<SqliteStore> {
    const dir = path.dirname(filePath);
    if (dir !== ".") {
      await fs.mkdir(dir, { recursive: true });
    }

    const db = new Database(filePath, { create: true });

    try {
      // Set pragmas
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA busy_timeout = 5000;");
      db.exec("PRAGMA synchronous = NORMAL;");

      SqliteStore.guardFormatVersion(db);

      // Initialize DDL
      db.exec(DDL);

      // Seed meta if missing
      db.prepare(
        `INSERT OR IGNORE INTO meta (key, value) VALUES ('instance_id', ?), ('last_seq', '0'), ('format_version', '${FormatVersion}')`
      ).run(EntryUtils.newID());

      const indexing = search.enabled && SearchIndex.available(db);
      let rebuildDue = false;
      if (indexing) {
        rebuildDue = SearchIndex.install(db, search.tokenizer);
        if (!rebuildDue) rebuildDue = SearchIndex.isEmptyWithContent(db);
      } else {
        // Switched off, or a build without FTS5. Invalidate the stamp so a
        // later enabled start rebuilds rather than trusting rows that went
        // stale while nothing maintained them — but do not drop anything:
        // opening a store must not destroy the index a differently-configured
        // process is keeping on the same data dir.
        SearchIndex.disable(db);
      }

      return new SqliteStore(db, indexing, rebuildDue);
    } catch (err) {
      db.close();
      throw err;
    }
  }

  /** True when the index exists but has not been filled yet. */
  needsSearchRebuild(): boolean {
    return this.indexing && this.rebuildDue;
  }

  searchIndexed(): boolean {
    return this.indexing;
  }

  /**
   * The native engine, or `null` when this build has no FTS5 or search is off
   * — the caller then uses the portable `ScanSearcher`, which is why a missing
   * FTS5 degrades rather than fails (D30). Constructed here rather than
   * outside so the `Database` stays private to the adapter.
   */
  createSearcher(tokenizer: string): SqliteSearcher | null {
    return this.indexing ? new SqliteSearcher(this.db, this, tokenizer) : null;
  }

  /** Marks the index filled; called once a rebuild has run. */
  searchRebuilt(): void {
    this.rebuildDue = false;
  }

  // A pre-D18 data dir has `schemas`/`entries` tables without project/env
  // columns. `CREATE TABLE IF NOT EXISTS` would silently leave those old
  // tables in place and every scoped query would then crash on "no such
  // column" instead of failing loudly, so check the stamped format_version
  // before running DDL. The `format_version` meta row alone isn't a
  // sufficient check — a pre-D18 db with old-shaped tables but a missing or
  // stale meta row would sail through it and still crash later — so this
  // also inspects the actual table shape directly.
  private static guardFormatVersion(db: Database): void {
    const tableNames = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
        (r) => r.name
      )
    );
    if (!tableNames.has("meta")) return; // fresh data dir; DDL will create everything

    const row = db.prepare(`SELECT value FROM meta WHERE key = 'format_version'`).get() as
      | { value: string }
      | undefined;
    if (row && row.value !== FormatVersion) {
      throw new Error(
        `this data directory uses format_version "${row.value}"; export with the previous binary and re-import, or start from a fresh data dir`
      );
    }

    for (const table of ["schemas", "entries"] as const) {
      if (!tableNames.has(table)) continue;
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!cols.some((c) => c.name === "project")) {
        throw new Error(
          `this data directory uses format_version "${row ? row.value : "1"}"; export with the previous binary and re-import, or start from a fresh data dir`
        );
      }
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private static rowToEntry(row: any): Entry {
    return {
      id: row.id,
      project: row.project,
      env: row.env,
      collection: row.collection,
      rev: Number(row.rev),
      seq: Number(row.seq),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      data: JSON.parse(row.data),
    };
  }

  // ---- Projects and Environments ----

  async createProject(project: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    const now = EntryUtils.now().toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO projects (id, created_at, updated_at) VALUES (?, ?, ?)
    `).run(project, now, now);
  }

  async listProjects(): Promise<string[]> {
    const rows = this.db.prepare(`
      SELECT DISTINCT id FROM (
        SELECT id FROM projects
        UNION
        SELECT project AS id FROM environments
        UNION
        SELECT project AS id FROM schemas
        UNION
        SELECT project AS id FROM entries
      ) WHERE SUBSTR(id, 1, 1) != '_' ORDER BY id
    `).all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  async deleteProject(project: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM entries WHERE project = ?`).run(project);
      // In the same transaction as the bulk entry delete. A layer above the
      // port could intercept this call but could not be atomic with it, which
      // is the reason usages live on `Storage` (D23) — otherwise the entries
      // would vanish while their references survived, and a media file would
      // stay blocked by referrers that no longer exist.
      this.db.prepare(`DELETE FROM media_references WHERE project = ?`).run(project);
      if (this.indexing) {
        this.db.prepare(`DELETE FROM ${SearchIndex.Documents} WHERE project = ?`).run(project);
      }
      this.db.prepare(`DELETE FROM schemas WHERE project = ?`).run(project);
      this.db.prepare(`DELETE FROM environments WHERE project = ?`).run(project);
      this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(project);
    });
    tx();
  }

  async createEnvironment(project: string, env: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");
    const now = EntryUtils.now().toISOString();
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR IGNORE INTO projects (id, created_at, updated_at) VALUES (?, ?, ?)
      `).run(project, now, now);
      this.db.prepare(`
        INSERT OR IGNORE INTO environments (project, id, created_at, updated_at) VALUES (?, ?, ?, ?)
      `).run(project, env, now, now);
    });
    tx();
  }

  async listEnvironments(project: string): Promise<string[]> {
    EntryUtils.assertSafeSegment(project, "project");
    const rows = this.db.prepare(`
      SELECT DISTINCT id FROM (
        SELECT id FROM environments WHERE project = ?
        UNION
        SELECT env AS id FROM schemas WHERE project = ?
        UNION
        SELECT env AS id FROM entries WHERE project = ?
      ) WHERE SUBSTR(id, 1, 1) != '_' ORDER BY id
    `).all(project, project, project) as { id: string }[];
    return rows.map((r) => r.id);
  }

  async deleteEnvironment(project: string, env: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM entries WHERE project = ? AND env = ?`).run(project, env);
      this.db.prepare(`DELETE FROM media_references WHERE project = ? AND env = ?`).run(project, env);
      if (this.indexing) {
        this.db.prepare(`DELETE FROM ${SearchIndex.Documents} WHERE project = ? AND env = ?`).run(project, env);
      }
      this.db.prepare(`DELETE FROM schemas WHERE project = ? AND env = ?`).run(project, env);
      this.db.prepare(`DELETE FROM environments WHERE project = ? AND id = ?`).run(project, env);
    });
    tx();
  }

  // ---- Schemas ----

  async putSchema(scope: Scope, collection: string, schema: any): Promise<void> {
    this.db.prepare(`
      INSERT INTO schemas (project, env, collection, schema, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (project, env, collection) DO UPDATE SET schema = excluded.schema, updated_at = excluded.updated_at
    `).run(scope.project, scope.env, collection, JSON.stringify(schema), EntryUtils.now().toISOString());
  }

  async getSchema(scope: Scope, collection: string): Promise<any> {
    const row = this.db.prepare(
      `SELECT schema FROM schemas WHERE project = ? AND env = ? AND collection = ?`
    ).get(scope.project, scope.env, collection) as { schema: string } | undefined;
    if (!row) {
      throw new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
    }
    return JSON.parse(row.schema);
  }

  async listSchemas(scope: Scope): Promise<Map<string, any>> {
    const rows = this.db.prepare(
      `SELECT collection, schema FROM schemas WHERE project = ? AND env = ?`
    ).all(scope.project, scope.env) as { collection: string; schema: string }[];
    const result = new Map<string, any>();
    for (const row of rows) {
      result.set(row.collection, JSON.parse(row.schema));
    }
    return result;
  }

  async deleteSchema(scope: Scope, collection: string): Promise<void> {
    const res = this.db.prepare(`
      DELETE FROM schemas WHERE project = ? AND env = ? AND collection = ?
    `).run(scope.project, scope.env, collection);
    if (res.changes === 0) {
      throw new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
    }
  }

  // ---- Entries ----
  // collection/id (and project/env on put) are validated as safe path
  // segments here even though SQLite has no filesystem to escape — this is
  // a Storage port contract both adapters enforce identically (see
  // storage.ts), so an import archive can't plant a malformed id that
  // behaves differently depending on which adapter is running.

  async put(e: Entry, derived: DerivedIndex): Promise<void> {
    const usages = derived.usages;
    EntryUtils.assertSafeSegment(e.project, "project");
    EntryUtils.assertSafeSegment(e.env, "env");
    EntryUtils.assertSafeSegment(e.collection, "collection");
    EntryUtils.assertSafeSegment(e.id, "id");

    const tx = this.db.transaction(() => {
      // Monotonically increment last_seq
      const row = this.db.prepare(`
        UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'last_seq' RETURNING CAST(value AS INTEGER) as seq
      `).get() as { seq: number } | undefined;

      if (!row) {
        throw new Error("failed to increment last_seq");
      }

      e.seq = row.seq;

      this.db.prepare(`
        INSERT INTO entries (id, project, env, collection, rev, seq, created_at, updated_at, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (project, env, collection, id) DO UPDATE SET
          rev = excluded.rev,
          seq = excluded.seq,
          updated_at = excluded.updated_at,
          data = excluded.data
      `).run(
        e.id,
        e.project,
        e.env,
        e.collection,
        e.rev,
        e.seq,
        typeof e.created_at === "string" ? e.created_at : e.created_at.toISOString(),
        typeof e.updated_at === "string" ? e.updated_at : e.updated_at.toISOString(),
        JSON.stringify(e.data)
      );

      // Inside the same transaction as the entry write, which is the whole
      // point of putting usages on the port rather than maintaining them in a
      // layer above it (D23): an entry and its references land together or
      // not at all, so no crash can leave a media file deletable while an
      // entry still names it.
      this.db.prepare(`
        DELETE FROM media_references WHERE project = ? AND env = ? AND collection = ? AND entry_id = ?
      `).run(e.project, e.env, e.collection, e.id);

      if (usages.length > 0) {
        const insert = this.db.prepare(`
          INSERT OR IGNORE INTO media_references (media_id, project, env, collection, entry_id)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const mediaId of usages) {
          insert.run(mediaId, e.project, e.env, e.collection, e.id);
        }
      }

      this.writeSearchDocument(e.project, e.env, e.collection, e.id, derived.search);
    });

    tx();
  }

  /**
   * Inserts or replaces one index document, or removes it when the caller
   * passed `search: null`. Always called from inside a caller's transaction,
   * never on its own — an entry and its index row land together or not at all.
   *
   * `ON CONFLICT DO UPDATE` rather than delete-then-insert, so `docid` survives
   * an update: `VACUUM` renumbers an implicit rowid, and re-inserting would
   * renumber it on every write, which is exactly the drift the explicit
   * `INTEGER PRIMARY KEY` exists to prevent.
   */
  private writeSearchDocument(
    project: string,
    env: string,
    collection: string,
    entryId: string,
    text: { label: string; body: string } | null
  ): void {
    if (!this.indexing) return;

    // Belt and braces on a security boundary: the caller passes `null` for
    // system data, and the adapter refuses it independently. One forgotten
    // argument must not make a `_keys` label findable by text (D30).
    if (text === null || project === Scope.System.project || EntryUtils.isSystemCollection(collection)) {
      this.db.prepare(`
        DELETE FROM ${SearchIndex.Documents}
        WHERE project = ? AND env = ? AND collection = ? AND entry_id = ?
      `).run(project, env, collection, entryId);
      return;
    }

    this.db.prepare(`
      INSERT INTO ${SearchIndex.Documents} (project, env, collection, entry_id, label, body)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (project, env, collection, entry_id) DO UPDATE SET
        label = excluded.label,
        body  = excluded.body
    `).run(project, env, collection, entryId, text.label, text.body);
  }

  async get(scope: Scope, collection: string, id: string): Promise<Entry> {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    const row = this.db.prepare(`
      SELECT id, project, env, collection, rev, seq, created_at, updated_at, data
      FROM entries
      WHERE project = ? AND env = ? AND collection = ? AND id = ?
    `).get(scope.project, scope.env, collection, id) as any;

    if (!row) {
      throw new NotFoundError(`entry ${scope.key()}/${collection}/${id} not found`);
    }

    return SqliteStore.rowToEntry(row);
  }

  async delete(scope: Scope, collection: string, id: string): Promise<void> {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    let changes = 0;
    const tx = this.db.transaction(() => {
      const res = this.db.prepare(
        `DELETE FROM entries WHERE project = ? AND env = ? AND collection = ? AND id = ?`
      ).run(scope.project, scope.env, collection, id);
      changes = res.changes;
      if (changes > 0) {
        this.db.prepare(`
          DELETE FROM media_references WHERE project = ? AND env = ? AND collection = ? AND entry_id = ?
        `).run(scope.project, scope.env, collection, id);
        if (this.indexing) {
          this.db.prepare(`
            DELETE FROM ${SearchIndex.Documents}
            WHERE project = ? AND env = ? AND collection = ? AND entry_id = ?
          `).run(scope.project, scope.env, collection, id);
        }
      }
    });
    tx();

    if (changes === 0) {
      throw new NotFoundError(`entry ${scope.key()}/${collection}/${id} not found`);
    }
  }

  async list(scope: Scope, collection: string, q: Query): Promise<{ items: Entry[]; total: number }> {
    EntryUtils.assertSafeSegment(collection, "collection");

    let where = "project = ? AND env = ? AND collection = ?";
    const whereArgs: any[] = [scope.project, scope.env, collection];

    if (q.filter) {
      const { cond, args } = SqliteCompiler.buildFilter(q.filter);
      where += " AND (" + cond + ")";
      whereArgs.push(...args);
    }

    // Get total count
    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM entries WHERE ${where}`).get(...whereArgs) as { total: number } | undefined;
    const total = countRow ? countRow.total : 0;

    const { order, args: orderArgs } = SqliteCompiler.buildOrder(q.sort || []);
    const limit = q.limit > 0 ? q.limit : 50;
    const offset = Math.max(q.offset, 0);

    const queryArgs = [...whereArgs, ...orderArgs, limit, offset];
    const rows = this.db.prepare(`
      SELECT id, project, env, collection, rev, seq, created_at, updated_at, data
      FROM entries
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ? OFFSET ?
    `).all(...queryArgs) as any[];

    const items: Entry[] = rows.map((row) => SqliteStore.rowToEntry(row));

    return { items, total };
  }

  async listScopes(): Promise<Scope[]> {
    const rows = this.db.prepare(`
      SELECT DISTINCT project, env FROM (
        SELECT project, id AS env FROM environments
        UNION
        SELECT project, env FROM schemas
        UNION
        SELECT project, env FROM entries
      )
    `).all() as { project: string; env: string }[];

    const scopes: Scope[] = [];
    for (const r of rows) {
      // Skip any `_`-prefixed project/env, not just the exact _system/_system
      // pair — same exclusion rule the fs adapter applies (D18 §5.4).
      if (r.project.startsWith("_") || r.env.startsWith("_")) {
        continue;
      }
      // A row that doesn't conform to the id grammar (hand-edited db, a bug
      // elsewhere) must be skipped, not allowed to crash every caller of
      // listScopes() — export in particular. Scope.of throws ValidationError
      // for exactly that case.
      try {
        scopes.push(Scope.of(r.project, r.env));
      } catch {
        continue;
      }
    }
    scopes.sort((a, b) => a.project.localeCompare(b.project) || a.env.localeCompare(b.env));
    return scopes;
  }

  async listEntryCollections(scope: Scope): Promise<string[]> {
    const rows = this.db.prepare(`
      SELECT DISTINCT collection FROM entries
      WHERE project = ? AND env = ?
      ORDER BY collection
    `).all(scope.project, scope.env) as { collection: string }[];
    return rows.map((r) => r.collection);
  }

  // ---- Media usages (D23) ----
  // Answered from `media_references`, which `put`/`delete`/`deleteProject`/
  // `deleteEnvironment` maintain inside their own transactions. Media ids
  // reach SQL as bound parameters like every other value.

  async listMediaUsages(
    mediaIds: string[],
    opts: { limit?: number; offset?: number } = {}
  ): Promise<{ items: MediaUsage[]; total: number }> {
    if (mediaIds.length === 0) return { items: [], total: 0 };

    const placeholders = mediaIds.map(() => "?").join(", ");
    const totalRow = this.db.prepare(`
      SELECT COUNT(*) as n FROM media_references WHERE media_id IN (${placeholders})
    `).get(...mediaIds) as { n: number };

    const limit = opts.limit === undefined ? 50 : Math.max(0, opts.limit);
    const offset = Math.max(0, opts.offset || 0);
    const rows = this.db.prepare(`
      SELECT media_id, project, env, collection, entry_id
      FROM media_references
      WHERE media_id IN (${placeholders})
      ORDER BY project, env, collection, entry_id
      LIMIT ? OFFSET ?
    `).all(...mediaIds, limit, offset) as MediaUsage[];

    return { items: rows, total: Number(totalRow.n) };
  }

  async countMediaUsages(mediaIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (mediaIds.length === 0) return out;

    const placeholders = mediaIds.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT media_id, COUNT(*) as n FROM media_references
      WHERE media_id IN (${placeholders})
      GROUP BY media_id
    `).all(...mediaIds) as { media_id: string; n: number }[];

    for (const row of rows) {
      out.set(row.media_id, Number(row.n));
    }
    return out;
  }

  async meta(): Promise<Meta> {
    const instanceIdRow = this.db.prepare(`SELECT value FROM meta WHERE key = 'instance_id'`).get() as { value: string } | undefined;
    const lastSeqRow = this.db.prepare(`SELECT CAST(value AS INTEGER) as seq FROM meta WHERE key = 'last_seq'`).get() as { seq: number } | undefined;

    return {
      instance_id: instanceIdRow ? instanceIdRow.value : "",
      last_seq: lastSeqRow ? lastSeqRow.seq : 0,
    };
  }
}
