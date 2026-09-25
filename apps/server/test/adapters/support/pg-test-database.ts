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
