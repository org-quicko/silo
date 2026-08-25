import type { Database } from "bun:sqlite";
import { EntryUtils } from "../../../core/domain/entry-utils";
import { FormatVersion } from "../../../core/transfer/format-version";

/** The database's shape, and the guard that refuses a data directory written
 *  by an incompatible format. */
export class SqliteMigrations {
  private static readonly Ddl = `
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

  /** WAL for concurrent readers, a busy timeout so a brief writer overlap
   *  waits rather than fails, and NORMAL sync — durable across a process
   *  crash, which is the failure D25's run file already bounds. */
  static applyPragmas(database: Database): void {
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec("PRAGMA synchronous = NORMAL;");
  }

  static applyDdl(database: Database): void {
    database.exec(SqliteMigrations.Ddl);
  }

  /** Seeds the instance id, sequence counter and format stamp, once. */
  static seedMeta(database: Database): void {
    database
      .prepare(
        `INSERT OR IGNORE INTO meta (key, value) VALUES ('instance_id', ?), ('last_seq', '0'), ('format_version', '${FormatVersion}')`
      )
      .run(EntryUtils.newID());
  }

  /**
   * Refuses a pre-D18 data directory before any DDL runs.
   *
   * Those have `schemas`/`entries` tables without project/env columns, and
   * `CREATE TABLE IF NOT EXISTS` would silently leave them in place — every
   * scoped query would then crash on "no such column" instead of failing
   * loudly. The `format_version` meta row alone is not sufficient, because a
   * pre-D18 database with old-shaped tables and a missing row would sail
   * through it, so the actual table shape is inspected too.
   */
  static guardFormatVersion(database: Database): void {
    const tableNames = new Set(
      (
        database
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
          .all() as { name: string }[]
      ).map((row) => row.name)
    );
    // A fresh data dir; the DDL will create everything.
    if (!tableNames.has("meta")) return;

    const stamped = database
      .prepare(`SELECT value FROM meta WHERE key = 'format_version'`)
      .get() as { value: string } | undefined;
    if (stamped && stamped.value !== FormatVersion) {
      throw SqliteMigrations.incompatible(stamped.value);
    }

    for (const table of ["schemas", "entries"] as const) {
      if (!tableNames.has(table)) continue;

      const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some((column) => column.name === "project")) {
        throw SqliteMigrations.incompatible(stamped ? stamped.value : "1");
      }
    }
  }

  private static incompatible(found: string): Error {
    return new Error(
      `this data directory uses format_version "${found}"; export with the previous binary and re-import, or start from a fresh data dir`
    );
  }
}
