import { EntryUtils } from "../../../core/domain/entry-utils";
import { Scope } from "../../../core/domain/scope";
import { SystemCollections } from "../../../core/domain/system-collections";
import { FormatVersion } from "../../../core/transfer/format-version";
import type { PgConnection } from "./pg-connection";
import type { PgQueryable } from "./pg-queryable";
import { PgTables } from "./pg-tables";

/**
 * The schema's shape, the guard that refuses one this binary cannot read, and
 * the reserved records.
 *
 * The tables are SQLite's (`SqliteMigrations` explains the composite keys and
 * the cascades), with three Postgres choices (docs/design/storage.md §6.6):
 *
 * - Every text column is `COLLATE "C"`, so names, ids and timestamps compare
 *   and sort by codepoint whatever the database's locale (D92), and the
 *   primary key index serves `ORDER BY id`.
 * - `data` is `jsonb`, the fastest form to store and query.
 * - `schema` is `text`, so it comes back byte for byte: its `properties` order
 *   is the admin form's field order.
 */
export class PgMigrations {
  /** `client_connection_check_interval`, which ends a query whose client has gone, arrived in 14. */
  static readonly MinimumServerVersion = 140000;

  static async assertServerVersion(database: PgQueryable): Promise<void> {
    const [row] = await database.query<{ version: number }>(
      `SELECT current_setting('server_version_num')::int AS version`
    );
    if (row.version < PgMigrations.MinimumServerVersion) {
      throw new Error(
        `Postgres ${PgMigrations.describe(row.version)} is too old; silo needs 14 or later`
      );
    }
  }

  /**
   * The shape, the meta rows and the reserved records, in one transaction, for
   * the reason `SqliteMigrations.initialize` gives.
   *
   * The transaction takes an advisory lock scoped to the schema first, so two
   * processes starting on an empty schema at once do not both run the DDL:
   * `CREATE ... IF NOT EXISTS` is not safe against a concurrent create, and the
   * loser would fail on a catalog unique index instead of waiting.
   */
  static async initialize(connection: PgConnection, tables: PgTables): Promise<void> {
    await connection.transaction(async (session) => {
      await session.query(`SET LOCAL client_min_messages = warning`);
      await session.query(`SELECT pg_advisory_xact_lock(hashtext('silo.ddl'), hashtext($1))`, [
        tables.schema,
      ]);

      const state = await PgMigrations.guardFormatVersion(session, tables);
      if (state.schemaMissing) {
        await session.query(`CREATE SCHEMA ${tables.quotedSchema}`);
      }
      if (!state.complete) {
        for (const statement of PgMigrations.ddl(tables)) await session.query(statement);
      }
      await PgMigrations.seedMeta(session, tables);
      await PgMigrations.seedSystemRecords(session, tables);
    });
  }

  /**
   * Refuses a schema this binary cannot read, before any DDL runs.
   *
   * Stricter than the SQLite guard in one way: a table with one of silo's
   * names in a schema with no format stamp is refused, because the schema may
   * be shared with another application and `CREATE TABLE IF NOT EXISTS` would
   * otherwise adopt its table.
   */
  private static async guardFormatVersion(
    database: PgQueryable,
    tables: PgTables
  ): Promise<{ schemaMissing: boolean; complete: boolean }> {
    const [schema] = await database.query<{ found: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS found`,
      [tables.schema]
    );
    if (!schema.found) return { schemaMissing: true, complete: false };

    const rows = await database.query<{ name: string }>(
      `SELECT c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`,
      [tables.schema]
    );
    const present = new Set(rows.map((row) => row.name));
    const ours = PgTables.Names.filter((name) => present.has(name));
    if (ours.length === 0) return { schemaMissing: false, complete: false };

    const stamped = present.has("meta") ? await PgMigrations.stamp(database, tables) : null;
    if (stamped === null) {
      throw new Error(
        `Postgres schema "${tables.schema}" already holds a table named "${ours[0]}" that silo did not create; point [storage] schema at another schema`
      );
    }
    if (stamped !== FormatVersion) {
      throw new Error(
        `Postgres schema "${tables.schema}" uses format_version "${stamped}"; export with the previous binary and re-import, or point [storage] schema at a new schema`
      );
    }
    return { schemaMissing: false, complete: ours.length === PgTables.Names.length };
  }

  /** The stamped format version, or null when `meta` is not silo's table. */
  private static async stamp(database: PgQueryable, tables: PgTables): Promise<string | null> {
    try {
      const [row] = await database.query<{ value: string }>(
        `SELECT value FROM ${tables.meta} WHERE key = 'format_version'`
      );
      return row ? row.value : null;
    } catch {
      return null;
    }
  }

  private static ddl(tables: PgTables): string[] {
    const text = `text COLLATE "C"`;
    return [
      `CREATE TABLE IF NOT EXISTS ${tables.meta} (
         key   ${text} PRIMARY KEY,
         value text NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS ${tables.projects} (
         id         ${text} PRIMARY KEY,
         name       ${text} NOT NULL UNIQUE,
         created_at ${text} NOT NULL,
         updated_at ${text} NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS ${tables.environments} (
         id         ${text} PRIMARY KEY,
         project_id ${text} NOT NULL REFERENCES ${tables.projects} (id),
         name       ${text} NOT NULL,
         created_at ${text} NOT NULL,
         updated_at ${text} NOT NULL,
         UNIQUE (project_id, name),
         UNIQUE (project_id, id)
       )`,
      `CREATE TABLE IF NOT EXISTS ${tables.collections} (
         id         ${text} PRIMARY KEY,
         project_id ${text} NOT NULL,
         env_id     ${text} NOT NULL,
         name       ${text} NOT NULL,
         schema     text NOT NULL,
         created_at ${text} NOT NULL,
         updated_at ${text} NOT NULL,
         FOREIGN KEY (project_id, env_id) REFERENCES ${tables.environments} (project_id, id),
         UNIQUE (env_id, name),
         UNIQUE (project_id, env_id, id)
       )`,
      `CREATE TABLE IF NOT EXISTS ${tables.entries} (
         id            ${text} NOT NULL,
         project_id    ${text} NOT NULL,
         env_id        ${text} NOT NULL,
         collection_id ${text} NOT NULL,
         rev           bigint NOT NULL,
         seq           bigint NOT NULL UNIQUE,
         created_at    ${text} NOT NULL,
         updated_at    ${text} NOT NULL,
         data          jsonb NOT NULL,
         PRIMARY KEY (collection_id, id),
         FOREIGN KEY (project_id, env_id, collection_id)
           REFERENCES ${tables.collections} (project_id, env_id, id)
       )`,
      `CREATE INDEX IF NOT EXISTS entries_env_idx ON ${tables.entries} (env_id)`,
      `CREATE INDEX IF NOT EXISTS entries_project_idx ON ${tables.entries} (project_id)`,
      `CREATE TABLE IF NOT EXISTS ${tables.mediaReferences} (
         media_id      ${text} NOT NULL,
         project_id    ${text} NOT NULL,
         env_id        ${text} NOT NULL,
         collection_id ${text} NOT NULL,
         entry_id      ${text} NOT NULL,
         PRIMARY KEY (media_id, collection_id, entry_id),
         FOREIGN KEY (collection_id, entry_id)
           REFERENCES ${tables.entries} (collection_id, id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS media_references_entry_idx
         ON ${tables.mediaReferences} (collection_id, entry_id)`,
    ];
  }

  /** The instance id, sequence counter, format stamp and defaults flag, once. */
  private static async seedMeta(database: PgQueryable, tables: PgTables): Promise<void> {
    await database.query(
      `INSERT INTO ${tables.meta} (key, value) VALUES
         ('instance_id', $1),
         ('last_seq', '0'),
         ('format_version', $2),
         ('defaults_initialized', '0')
       ON CONFLICT (key) DO NOTHING`,
      [EntryUtils.newID(), FormatVersion]
    );
  }

  /**
   * The reserved scope and its collections, with their names as their ids, for
   * the reasons `SqliteMigrations.seedSystemRecords` gives. Run on every open,
   * so a collection a newer binary reserves is added to an existing schema.
   */
  private static async seedSystemRecords(database: PgQueryable, tables: PgTables): Promise<void> {
    const now = EntryUtils.now().toISOString();
    const system = Scope.System.project;

    await database.query(
      `INSERT INTO ${tables.projects} (id, name, created_at, updated_at)
       VALUES ($1, $1, $2, $2) ON CONFLICT DO NOTHING`,
      [system, now]
    );
    await database.query(
      `INSERT INTO ${tables.environments} (id, project_id, name, created_at, updated_at)
       VALUES ($1, $2, $1, $3, $3) ON CONFLICT DO NOTHING`,
      [Scope.System.env, system, now]
    );
    await database.query(
      `INSERT INTO ${tables.collections}
         (id, project_id, env_id, name, schema, created_at, updated_at)
       SELECT name, $2, $3, name, $4, $5, $5
       FROM jsonb_array_elements_text($1::text::jsonb) AS reserved(name)
       ON CONFLICT DO NOTHING`,
      [
        JSON.stringify(SystemCollections.All),
        system,
        Scope.System.env,
        JSON.stringify(SystemCollections.Schema),
        now,
      ]
    );
  }

  /** `140005` as `14.5`, the way an operator reads it. */
  private static describe(version: number): string {
    return `${Math.floor(version / 10000)}.${version % 10000}`;
  }
}
