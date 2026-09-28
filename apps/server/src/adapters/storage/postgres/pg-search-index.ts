import { SearchText } from "../../../core/search/search-text";
import type { PgConnection } from "./pg-connection";
import type { PgQueryable } from "./pg-queryable";
import type { PgSearchTokenizer } from "./pg-search-tokenizer";
import type { PgTables } from "./pg-tables";

/** The index a store keeps: the form its rows are written in, and whether the table still has to be filled. */
export interface PgSearchState {
  tokenizer: PgSearchTokenizer;
  rebuildDue: boolean;
}

/**
 * The Postgres side of search: the `entry_search` table, its index and its
 * version stamp (D30), with the rules `SearchIndex` follows on SQLite.
 *
 * - The stamp names the engine's shape, the extractor and the tokenizer; a
 *   change in any of them drops and recreates the table, and the caller must
 *   refill it.
 * - Search off clears the stamp and drops nothing.
 * - Only the schema's owner shapes the index (D103). Every CLI command opens
 *   the store, and one with other `[search]` settings than the running
 *   server's would otherwise drop the server's table and refill it in a form
 *   the server's own writes and queries do not match. A process that finds
 *   another holding the owner lock changes nothing and follows the stamp.
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
   * Brings the index in line with `wanted`, under the DDL lock `PgMigrations`
   * takes, and says what the store must keep: the tokenizer its writes and
   * queries use, and whether the table has to be filled; null when there is
   * no index to keep.
   *
   * `owner` is true once this process holds the owner lock. When it does not,
   * and another process does, nothing is changed and the stamp is followed
   * instead: its tokenizer when this binary wrote that form, no index when it
   * did not. With no owner at all, `wanted` applies, as it always has for a
   * command run against a stopped instance.
   *
   * `trigram` needs `pg_trgm` and refuses to start without it, naming the fix,
   * rather than install an extension into the operator's database unasked.
   */
  static async settle(
    connection: PgConnection,
    tables: PgTables,
    wanted: { enabled: boolean; tokenizer: PgSearchTokenizer },
    owner: boolean
  ): Promise<PgSearchState | null> {
    return connection.transaction(async (session) => {
      await session.query(`SET LOCAL client_min_messages = warning`);
      await session.query(`SELECT pg_advisory_xact_lock(hashtext('silo.ddl'), hashtext($1))`, [
        tables.schema,
      ]);
      const stamped = await PgSearchIndex.readStamp(session, tables);
      if (!owner && (await PgSearchIndex.ownedByAnother(session, tables))) {
        return PgSearchIndex.follow(stamped);
      }

      if (!wanted.enabled) {
        await session.query(`DELETE FROM ${tables.meta} WHERE key = $1`, [PgSearchIndex.StampKey]);
        return null;
      }

      const operators =
        wanted.tokenizer === "trigram" ? await PgSearchIndex.trigramOperators(session) : null;
      const want = PgSearchIndex.stamp(wanted.tokenizer);
      if (stamped !== want) await session.query(`DROP TABLE IF EXISTS ${tables.searchDocuments}`);

      for (const statement of PgSearchIndex.ddl(tables, operators)) await session.query(statement);
      await session.query(
        `INSERT INTO ${tables.meta} (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        [PgSearchIndex.StampKey, want]
      );
      // A stale table was just recreated empty, so one question covers both
      // cases, and a fresh schema with nothing in it owes no rebuild.
      return { tokenizer: wanted.tokenizer, rebuildDue: await PgSearchIndex.isEmptyWithContent(session, tables) };
    });
  }

  /** The index a stamp describes, when this binary writes that form; never a rebuild, which is the owner's. */
  private static follow(stamped: string | null): PgSearchState | null {
    for (const tokenizer of ["unicode61", "trigram"] as const) {
      if (stamped === PgSearchIndex.stamp(tokenizer)) return { tokenizer, rebuildDue: false };
    }
    return null;
  }

  private static async readStamp(database: PgQueryable, tables: PgTables): Promise<string | null> {
    const [row] = await database.query<{ value: string }>(
      `SELECT value FROM ${tables.meta} WHERE key = $1`,
      [PgSearchIndex.StampKey]
    );
    return row ? row.value : null;
  }

  /**
   * True when some session holds the owner lock for this schema (D25). Read
   * from `pg_locks` rather than tried: a try that won would hold the lock, and
   * a server starting at that moment would be refused as if one were running.
   * The two keys of a two-key advisory lock are its `classid` and `objid`.
   */
  private static async ownedByAnother(database: PgQueryable, tables: PgTables): Promise<boolean> {
    const [row] = await database.query<{ owned: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks l
         WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 2
           AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND l.classid::bigint = (hashtext('silo.owner')::bigint & 4294967295)
           AND l.objid::bigint = (hashtext($1)::bigint & 4294967295)
       ) AS owned`,
      [tables.schema]
    );
    return row.owned;
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
