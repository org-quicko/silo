import { PgConnection } from "./pg-connection";
import type { PgReservedSession } from "./pg-connection";
import type { PgTables } from "./pg-tables";

/**
 * D25 at the database: one server owns a schema at a time.
 *
 * `RunFile` enforces single ownership per data directory, but two servers with
 * different data directories can point at one database, and the rev checks,
 * the `seq` counter's ordering, the name cache and the write lock would all
 * then be wrong without anything noticing. A session advisory lock, keyed by
 * the schema, turns the second server away.
 *
 * It lives on a connection of its own, outside the store's pool, because a
 * session lock belongs to the connection that took it: a pooled connection
 * would carry the lock back into the pool and hand it to whichever statement
 * ran there next. Losing that connection loses the lock; noticing that is the
 * heartbeat's job (docs/design/storage.md §6.6).
 */
export class PgOwnerLock {
  private readonly connection: PgConnection;
  private readonly session: PgReservedSession;
  private releasing: Promise<void> | null = null;

  private constructor(connection: PgConnection, session: PgReservedSession) {
    this.connection = connection;
    this.session = session;
  }

  /** Takes the lock, or refuses at once with the schema that is taken. Never waits. */
  static async acquire(url: string, tables: PgTables, applicationName: string): Promise<PgOwnerLock> {
    const connection = PgConnection.open({
      url,
      max: 1,
      applicationName: `${applicationName} owner`,
    });
    let session: PgReservedSession | null = null;
    try {
      session = await connection.reserve();
      const [row] = await session.query<{ held: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext('silo.owner'), hashtext($1)) AS held`,
        [tables.schema]
      );
      if (!row.held) {
        throw new Error(
          `another silo server already owns Postgres schema "${tables.schema}" in this database; stop it first, or point [storage] schema elsewhere`
        );
      }
      return new PgOwnerLock(connection, session);
    } catch (error) {
      session?.release();
      await connection.close();
      throw error;
    }
  }

  /** Gives the lock up and closes its connection. Safe to call more than once. */
  async release(): Promise<void> {
    this.releasing ??= this.unlock();
    await this.releasing;
  }

  private async unlock(): Promise<void> {
    try {
      await this.session.query(`SELECT pg_advisory_unlock_all()`);
    } catch {
      // The connection is already gone, and the lock went with it.
    } finally {
      this.session.release();
      await this.connection.close();
    }
  }
}
