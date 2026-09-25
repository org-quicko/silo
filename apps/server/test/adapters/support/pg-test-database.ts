import { SQL } from "bun";
import { EntryUtils } from "../../../src/core/domain/entry-utils";

/**
 * The Postgres the adapter tests run against, when there is one.
 *
 * Every test gets a schema of its own and drops it afterwards, so tests never
 * see each other's rows and a run leaves the database as it found it.
 */
export class PgTestDatabase {
  /** Holds a `postgres://` URL. Unset, the Postgres tests are skipped and say so. */
  static readonly Variable = "SILO_TEST_PG_URL";

  static url(): string | undefined {
    return process.env[PgTestDatabase.Variable] || undefined;
  }

  /** A schema name no other test uses, and a valid one: ULIDs lower-cased. */
  static freshSchema(): string {
    return `silo_test_${EntryUtils.newID().toLowerCase()}`;
  }

  /** Runs `work` on a short-lived connection of its own, outside any store. */
  static async admin<T>(work: (sql: SQL) => Promise<T>): Promise<T> {
    const sql = new SQL({ url: PgTestDatabase.url()!, max: 1, prepare: false });
    try {
      return await work(sql);
    } finally {
      await sql.close();
    }
  }

  static async drop(schema: string): Promise<void> {
    await PgTestDatabase.admin((sql) => sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
  }

  /**
   * Kills every session named exactly `applicationName`, the way a failover or
   * an operator's `pg_terminate_backend` would. The test role may end its own
   * sessions without being a superuser.
   */
  static async kill(applicationName: string): Promise<number> {
    const rows = await PgTestDatabase.admin((sql) =>
      sql.unsafe(
        `SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity
         WHERE application_name = $1 AND datname = current_database()`,
        [applicationName]
      )
    );
    return rows.length;
  }

  /**
   * Makes `pg_trgm` available for the trigram tests, and says how to undo it.
   *
   * An extension installed already is used as it is and left alone. A missing
   * one is installed into a schema of its own, so dropping that schema at the
   * end removes it again and the database is left as it was found. When the
   * role may not install it, the trigram tests are skipped.
   */
  static async ensureTrigram(): Promise<{ ready: boolean; cleanup: () => Promise<void> }> {
    const none = async () => {};
    const installed = await PgTestDatabase.admin((sql) =>
      sql.unsafe(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`)
    );
    if (installed.length > 0) return { ready: true, cleanup: none };

    const schema = `silo_test_trgm_${EntryUtils.newID().toLowerCase()}`;
    try {
      await PgTestDatabase.admin(async (sql) => {
        await sql.unsafe(`CREATE SCHEMA "${schema}"`);
        await sql.unsafe(`CREATE EXTENSION pg_trgm SCHEMA "${schema}"`);
      });
    } catch {
      await PgTestDatabase.drop(schema).catch(() => {});
      return { ready: false, cleanup: none };
    }
    return { ready: true, cleanup: () => PgTestDatabase.drop(schema) };
  }

  /** A name for a test's sessions that no other test's share. */
  static freshApplicationName(): string {
    return `silo_test_${EntryUtils.newID().toLowerCase()}`;
  }

  /** How many of this database's sessions carry `applicationName`. */
  static async sessions(applicationName: string): Promise<number> {
    const rows = await PgTestDatabase.admin((sql) =>
      sql.unsafe(
        `SELECT count(*) AS total FROM pg_stat_activity
         WHERE application_name LIKE $1 AND datname = current_database()`,
        [`${applicationName}%`]
      )
    );
    return Number(rows[0].total);
  }
}
