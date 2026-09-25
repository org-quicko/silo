import { PgConnection } from "./pg-connection";
import type { PgReservedSession } from "./pg-connection";
import { PgOwnershipTakenError } from "./pg-ownership-taken-error";
import type { PgTables } from "./pg-tables";
import { PgUnavailableError } from "./pg-unavailable-error";

/** How to take the lock and watch it. */
export interface PgOwnerLockOptions {
  url: string;
  tables: PgTables;
  applicationName: string;
  /** How often the lock's connection is checked. */
  heartbeatMs: number;
  /** Called once, when the lock was lost and another server has taken it. */
  lost: (reason: Error) => void;
}

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
 * ran there next. Losing that connection loses the lock, so a heartbeat checks
 * it (docs/design/storage.md §6.6):
 *
 * - while the check answers, nothing changes;
 * - when it fails, writes are refused as `503` and the lock is taken again on
 *   a new connection;
 * - if another server took it in between, `lost` is called and the heartbeat
 *   stops. `serve` then exits, because nothing may write without the lock.
 *
 * Between the connection breaking and the next beat, at most `heartbeatMs`, a
 * write can still land; that is the window this design accepts.
 */
export class PgOwnerLock {
  private readonly options: PgOwnerLockOptions;
  private held: { connection: PgConnection; session: PgReservedSession } | null;
  private readonly timer: ReturnType<typeof setInterval>;
  private beating = false;
  private stopped = false;
  private releasing: Promise<void> | null = null;

  private constructor(
    options: PgOwnerLockOptions,
    held: { connection: PgConnection; session: PgReservedSession }
  ) {
    this.options = options;
    this.held = held;
    this.timer = setInterval(() => void this.beat(), options.heartbeatMs);
    // A heartbeat must never be what keeps a process alive.
    this.timer.unref?.();
  }

  /** Takes the lock, or refuses at once with the schema that is taken. Never waits. */
  static async acquire(options: PgOwnerLockOptions): Promise<PgOwnerLock> {
    return new PgOwnerLock(options, await PgOwnerLock.take(options));
  }

  /** `held` while the lock is ours, `retaking` while its connection is being replaced. */
  get state(): "held" | "retaking" | "lost" {
    if (this.held) return "held";
    return this.stopped ? "lost" : "retaking";
  }

  /** Refuses a write unless the lock is held right now. */
  assertHeld(): void {
    if (this.held) return;
    throw new PgUnavailableError(
      this.stopped
        ? "this server no longer owns its Postgres schema and is shutting down"
        : "this server is taking its Postgres schema's owner lock back; retry shortly",
      "busy"
    );
  }

  /** Gives the lock up and closes its connection. Safe to call more than once. */
  async release(): Promise<void> {
    this.releasing ??= (async () => {
      this.stopped = true;
      clearInterval(this.timer);
      const held = this.held;
      this.held = null;
      if (held) await PgOwnerLock.drop(held, true);
    })();
    await this.releasing;
  }

  /** One check, or one attempt to take the lock back. Never two at once. */
  private async beat(): Promise<void> {
    if (this.beating || this.stopped) return;
    this.beating = true;
    try {
      const current = this.held;
      if (current) {
        try {
          await current.session.query(`SELECT 1`);
          return;
        } catch {
          // `release` may have closed it under this check; then it is not ours to drop.
          if (this.stopped || this.held !== current) return;
          this.held = null;
          await PgOwnerLock.drop(current, false);
        }
      }

      let taken: { connection: PgConnection; session: PgReservedSession };
      try {
        taken = await PgOwnerLock.take(this.options);
      } catch (error) {
        if (error instanceof PgOwnershipTakenError) {
          this.stopped = true;
          clearInterval(this.timer);
          this.options.lost(error);
        }
        // Anything else is the server being unreachable: the next beat tries again.
        return;
      }
      if (this.stopped) await PgOwnerLock.drop(taken, true);
      else this.held = taken;
    } finally {
      this.beating = false;
    }
  }

  private static async take(
    options: PgOwnerLockOptions
  ): Promise<{ connection: PgConnection; session: PgReservedSession }> {
    const connection = PgConnection.open({
      url: options.url,
      max: 1,
      applicationName: `${options.applicationName} owner`,
    });
    let session: PgReservedSession | null = null;
    try {
      session = await connection.reserve();
      const [row] = await session.query<{ held: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext('silo.owner'), hashtext($1)) AS held`,
        [options.tables.schema]
      );
      if (!row.held) throw new PgOwnershipTakenError(options.tables.schema);
      return { connection, session };
    } catch (error) {
      session?.release();
      await connection.close(0);
      throw error;
    }
  }

  /** Closes a lock connection, unlocking first when it may still be alive. */
  private static async drop(
    held: { connection: PgConnection; session: PgReservedSession },
    unlock: boolean
  ): Promise<void> {
    if (unlock) {
      try {
        await held.session.query(`SELECT pg_advisory_unlock_all()`);
      } catch {
        // The connection is already gone, and the lock went with it.
      }
    }
    held.session.release();
    await held.connection.close(0);
  }
}
