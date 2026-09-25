import { SearchText } from "../../../core/search/search-text";
import type { PgConnection } from "./pg-connection";
import type { PgQueryable } from "./pg-queryable";
import type { PgSearchTokenizer } from "./pg-search-tokenizer";
import type { PgTables } from "./pg-tables";

/**
 * The Postgres side of search: the `entry_search` table, its index and its
 * version stamp (D30), with the rules `SearchIndex` follows on SQLite.
 *
 * - The stamp names the engine's shape, the extractor and the tokenizer; a
 *   change in any of them drops and recreates the table, and the caller must
 *   refill it.
 * - A store opened with search off clears the stamp and drops nothing, since
 *   every CLI command opens the store and must not destroy an index a running
 *   server keeps.
 * - Rows cascade from `entries`, so a delete of any size takes them along.
 */
export class PgSearchIndex {
  /** Bumped when the table, its index or `PgSearchDocument` changes. */
  static readonly EngineVersion = 1;
  static readonly StampKey = "search_index_version";

  static stamp(tokenizer: PgSearchTokenizer): string {
    return `postgres-${PgSearchIndex.EngineVersion}:${SearchText.Version}:${tokenizer}`;
  }

  /**
   * Creates the table, or recreates it when the stamp has moved, under the DDL
   * lock `PgMigrations` takes. Returns true when the caller must fill it: it
   * holds nothing while user entries exist.
   *
   * `trigram` needs `pg_trgm` and refuses to start without it, naming the fix,
   * rather than install an extension into the operator's database unasked.
   */
  static async install(
    connection: PgConnection,
    tables: PgTables,
    tokenizer: PgSearchTokenizer
  ): Promise<boolean> {
    return connection.transaction(async (session) => {
      await session.query(`SET LOCAL client_min_messages = warning`);
      await session.query(`SELECT pg_advisory_xact_lock(hashtext('silo.ddl'), hashtext($1))`, [
        tables.schema,
      ]);

      const operators = tokenizer === "trigram" ? await PgSearchIndex.trigramOperators(session) : null;
      const want = PgSearchIndex.stamp(tokenizer);
      const [row] = await session.query<{ value: string }>(
        `SELECT value FROM ${tables.meta} WHERE key = $1`,
        [PgSearchIndex.StampKey]
      );
      const stale = !row || row.value !== want;
      if (stale) await session.query(`DROP TABLE IF EXISTS ${tables.searchDocuments}`);

      for (const statement of PgSearchIndex.ddl(tables, operators)) await session.query(statement);
      await session.query(
        `INSERT INTO ${tables.meta} (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        [PgSearchIndex.StampKey, want]
      );
      // A stale table was just recreated empty, so one question covers both
      // cases, and a fresh schema with nothing in it owes no rebuild.
      return PgSearchIndex.isEmptyWithContent(session, tables);
    });
  }

  /** What an open with search off does: the stamp goes, the rows stay. */
  static async disable(database: PgQueryable, tables: PgTables): Promise<void> {
    await database.query(`DELETE FROM ${tables.meta} WHERE key = $1`, [PgSearchIndex.StampKey]);
  }

  /** `document` is filled under `unicode61`, `label` and `body` under `trigram`. */
  private static ddl(tables: PgTables, trigramOperators: string | null): string[] {
    const text = `text COLLATE "C"`;
    const statements = [
      `CREATE TABLE IF NOT EXISTS ${tables.searchDocuments} (
         project_id    ${text} NOT NULL,
         env_id        ${text} NOT NULL,
         collection_id ${text} NOT NULL,
         entry_id      ${text} NOT NULL,
         document      tsvector,
         label         text,
         body          text,
         PRIMARY KEY (collection_id, entry_id),
         FOREIGN KEY (collection_id, entry_id)
           REFERENCES ${tables.entries} (collection_id, id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS entry_search_scope_idx
         ON ${tables.searchDocuments} (env_id, collection_id)`,
    ];
    if (trigramOperators) {
      statements.push(
        `CREATE INDEX IF NOT EXISTS entry_search_label_idx
           ON ${tables.searchDocuments} USING gin (label ${trigramOperators})`,
        `CREATE INDEX IF NOT EXISTS entry_search_body_idx
           ON ${tables.searchDocuments} USING gin (body ${trigramOperators})`
      );
    } else {
      statements.push(
        `CREATE INDEX IF NOT EXISTS entry_search_document_idx
           ON ${tables.searchDocuments} USING gin (document)`
      );
    }
    return statements;
  }

  /** `pg_trgm`'s operator class, qualified with the schema the extension lives in. */
  private static async trigramOperators(database: PgQueryable): Promise<string> {
    const [row] = await database.query<{ schema: string }>(
      `SELECT quote_ident(n.nspname) AS schema
       FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = 'pg_trgm'`
    );
    if (!row) {
      throw new Error(
        `[search] tokenizer "trigram" needs the pg_trgm extension on Postgres: run "CREATE EXTENSION pg_trgm;" in this database, or set tokenizer = "unicode61"`
      );
    }
    return `${row.schema}.gin_trgm_ops`;
  }

  /**
   * True when nothing is indexed but a user collection holds entries — a
   * rebuild is due. System collections are left out on both sides: they are
   * never indexed, so counting them would ask for a rebuild at every start.
   */
  private static async isEmptyWithContent(database: PgQueryable, tables: PgTables): Promise<boolean> {
    const [row] = await database.query<{ due: boolean }>(
      `SELECT NOT EXISTS (SELECT 1 FROM ${tables.searchDocuments})
          AND EXISTS (
            SELECT 1 FROM ${tables.entries} e
              JOIN ${tables.projects} p ON p.id = e.project_id
              JOIN ${tables.collections} c ON c.id = e.collection_id
            WHERE left(p.name, 1) <> '_' AND left(c.name, 1) <> '_'
          ) AS due`
    );
    return row.due;
  }
}
