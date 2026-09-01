import type { Database } from "bun:sqlite";
import { EntryUtils } from "../../../core/domain/entry-utils";
import { Scope } from "../../../core/domain/scope";
import { SystemCollections } from "../../../core/domain/system-collections";
import { FormatVersion } from "../../../core/transfer/format-version";

/** The database's shape, and the guard that refuses a data directory written
 *  by an incompatible format. */
export class SqliteMigrations {
  /**
   * Projects, environments and collections are **keyed records** (D51): a ULID
   * primary key, and a `name` that is unique within its parent and freely
   * renameable because nothing else stores it.
   *
   * The relationships are **composite** rather than a column each. Independent
   * single-column keys would happily accept a `project_id` from one branch
   * beside an `env_id` from another, so each child references its parent as a
   * tuple, and each parent carries the extra `UNIQUE` a tuple reference needs
   * as its target.
   *
   * `media_references` and `entry_search` reference the entry tuple with
   * `ON DELETE CASCADE`, which is what keeps the existing bulk deletes correct:
   * they remove entries before their derived rows, an order that a
   * non-cascading child key would reject. The cascade fires `entry_search`'s
   * `AFTER DELETE` trigger too, so the FTS shadow table stays in step.
   */
  private static readonly Ddl = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS environments (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, name),
  UNIQUE (project_id, id)
);
CREATE TABLE IF NOT EXISTS collections (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  env_id     TEXT NOT NULL,
  name       TEXT NOT NULL,
  schema     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id, env_id) REFERENCES environments(project_id, id),
  UNIQUE (env_id, name),
  UNIQUE (project_id, env_id, id)
);
CREATE TABLE IF NOT EXISTS entries (
  id            TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  env_id        TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  rev           INTEGER NOT NULL,
  seq           INTEGER NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  data          TEXT NOT NULL,
  PRIMARY KEY (collection_id, id),
  FOREIGN KEY (project_id, env_id, collection_id)
    REFERENCES collections(project_id, env_id, id)
);
CREATE INDEX IF NOT EXISTS idx_entries_seq ON entries(seq);
CREATE INDEX IF NOT EXISTS idx_entries_env ON entries(env_id);
CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_id);
CREATE TABLE IF NOT EXISTS media_references (
  media_id      TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  env_id        TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  entry_id      TEXT NOT NULL,
  PRIMARY KEY (media_id, collection_id, entry_id),
  FOREIGN KEY (collection_id, entry_id)
    REFERENCES entries(collection_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_media_refs_entry ON media_references(collection_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id);
CREATE INDEX IF NOT EXISTS idx_collections_env ON collections(env_id);
`;

  /**
   * WAL for concurrent readers, a busy timeout so a brief writer overlap
   * waits rather than fails, NORMAL sync — durable across a process crash,
   * which is the failure D25's run file already bounds — and foreign keys on,
   * without which every key the DDL declares would be documentation.
   *
   * Runs outside any transaction, because `PRAGMA foreign_keys` is a silent
   * no-op inside one.
   */
  static applyPragmas(database: Database): void {
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec("PRAGMA synchronous = NORMAL;");
    database.exec("PRAGMA foreign_keys = ON;");
  }

  /**
   * The shape, the meta rows and the reserved records, in one transaction.
   *
   * They are one unit because a database carrying the tables but not the
   * `_system` records is one where the first key write fails a foreign key, and
   * a database carrying the records but not the format stamp is one the next
   * start refuses. Neither is a state worth being able to reach.
   */
  static initialize(database: Database): void {
    database.transaction(() => {
      database.exec(SqliteMigrations.Ddl);
      SqliteMigrations.seedMeta(database);
      SqliteMigrations.seedSystemRecords(database);
    })();
  }

  /** Seeds the instance id, sequence counter, format stamp and the
   *  defaults-seeded flag, once. */
  private static seedMeta(database: Database): void {
    database
      .prepare(
        `INSERT OR IGNORE INTO meta (key, value) VALUES
           ('instance_id', ?),
           ('last_seq', '0'),
           ('format_version', '${FormatVersion}'),
           ('defaults_initialized', '0')`
      )
      .run(EntryUtils.newID());
  }

  /**
   * The reserved scope and its collections, as records like any other.
   *
   * Their ids are the reserved names rather than minted ULIDs, so `_system` and
   * `_keys` address identically on every instance and an archive naming them
   * needs no translation. Nothing lists them: every listing filters on `name`,
   * and `_`-prefixed names are reserved.
   *
   * They carry `SystemCollections.Schema` because the column is `NOT NULL` and
   * nothing validates against it — system writes reach `store.put` directly and
   * never pass through `EntryService`.
   */
  private static seedSystemRecords(database: Database): void {
    const now = EntryUtils.now().toISOString();
    const system = Scope.System.project;

    database
      .prepare(
        `INSERT OR IGNORE INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
      )
      .run(system, system, now, now);
    database
      .prepare(
        `INSERT OR IGNORE INTO environments (id, project_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(Scope.System.env, system, Scope.System.env, now, now);

    const insert = database.prepare(
      `INSERT OR IGNORE INTO collections
         (id, project_id, env_id, name, schema, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const schema = JSON.stringify(SystemCollections.Schema);
    for (const name of SystemCollections.All) {
      insert.run(name, system, Scope.System.env, name, schema, now, now);
    }
  }

  /**
   * Refuses a data directory this binary cannot read, before any DDL runs.
   *
   * `CREATE TABLE IF NOT EXISTS` would silently leave an older shape in place
   * and every query would then crash on "no such column" instead of failing
   * loudly. The `format_version` meta row alone is not sufficient, because a
   * directory with old-shaped tables and a missing row would sail through it,
   * so the actual table shape is inspected too. There is no migration: export
   * with the previous binary and re-import.
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

    // A `schemas` table is by itself proof of a pre-D51 directory: collections
    // are rows in `collections` now, and nothing creates that table any more.
    if (tableNames.has("schemas")) {
      throw SqliteMigrations.incompatible(stamped ? stamped.value : "unknown");
    }

    if (tableNames.has("entries")) {
      const columns = database.prepare(`PRAGMA table_info(entries)`).all() as { name: string }[];
      if (!columns.some((column) => column.name === "collection_id")) {
        throw SqliteMigrations.incompatible(stamped ? stamped.value : "unknown");
      }
    }
  }

  /**
   * Every foreign key the tables declare, checked. Cheap on an empty database
   * and honest on one that was edited by hand or written by a bug.
   */
  static assertIntegrity(database: Database): void {
    const violations = database.prepare(`PRAGMA foreign_key_check`).all() as unknown[];
    if (violations.length > 0) {
      throw new Error(
        `this data directory has ${violations.length} foreign key violation(s); export with a previous binary and re-import, or start from a fresh data dir`
      );
    }
  }

  private static incompatible(found: string): Error {
    return new Error(
      `this data directory uses format_version "${found}"; export with the previous binary and re-import, or start from a fresh data dir`
    );
  }
}
