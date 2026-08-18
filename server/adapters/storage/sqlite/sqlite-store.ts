import { Database } from "bun:sqlite";
import fs from "fs/promises";
import path from "path";
import type { Storage } from "../../../core/ports/storage";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { Entry } from "../../../core/domain/entry";
import type { Meta } from "../../../core/domain/meta";
import { Scope } from "../../../core/domain/scope";
import type { Query } from "../../../core/query/query";
import { NotFoundError } from "../../../core/errors/not-found-error";
import { FormatVersion } from "../../../core/transfer/format-version";
import { SqliteCompiler } from "./sqlite-compiler";

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
CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project);
`;

export class SqliteStore implements Storage {
  private db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  static async open(filePath: string): Promise<SqliteStore> {
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

      return new SqliteStore(db);
    } catch (err) {
      db.close();
      throw err;
    }
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

  async put(e: Entry): Promise<void> {
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
    });

    tx();
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

    const res = this.db.prepare(
      `DELETE FROM entries WHERE project = ? AND env = ? AND collection = ? AND id = ?`
    ).run(scope.project, scope.env, collection, id);
    if (res.changes === 0) {
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

  async meta(): Promise<Meta> {
    const instanceIdRow = this.db.prepare(`SELECT value FROM meta WHERE key = 'instance_id'`).get() as { value: string } | undefined;
    const lastSeqRow = this.db.prepare(`SELECT CAST(value AS INTEGER) as seq FROM meta WHERE key = 'last_seq'`).get() as { seq: number } | undefined;

    return {
      instance_id: instanceIdRow ? instanceIdRow.value : "",
      last_seq: lastSeqRow ? lastSeqRow.seq : 0,
    };
  }
}
