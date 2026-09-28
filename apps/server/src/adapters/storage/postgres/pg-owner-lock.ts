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
  /** How long one check may take before the connection counts as lost.
   *  At least five seconds, and never less than `heartbeatMs`, when unset. */
  deadlineMs?: number;
  /** Seconds for one connection attempt when the lock is taken again. */
  connectTimeout?: number;
  /** Called once, when the lock was lost and another server has taken it. */
  lost: (reason: Error) => void;
}

/** The lock's connection, and the backend it is on: its pid and start time name it exactly. */
interface HeldLock {
  connection: PgConnection;
  session: PgReservedSession;
  backend: PgBackend;
}

interface PgBackend {
  pid: number;
  started: string;
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
 * - while the check answers within `deadlineMs`, nothing changes;
 * - when it fails or does not answer — a partition answers nothing at all —
 *   writes are refused as `503` and the lock is taken again on a new
 *   connection;
 * - if the lock is still held by the backend this server lost, which a healed
 *   partition leaves behind, that backend is ended and the lock taken back;
 * - if another server took it in between, `lost` is called and the heartbeat
 *   stops. `serve` then exits, because nothing may write without the lock.
 *
 * Between the connection breaking and the next beat, at most `heartbeatMs`, a
 * write can still land; that is the window this design accepts.
 */
export class PgOwnerLock {
  private static readonly MinDeadlineMs = 5_000;
  /** How long a retake waits for an ended backend to let its lock go. */
  private static readonly HandoverMs = 2_000;

  private readonly options: PgOwnerLockOptions;
  private readonly deadlineMs: number;
  private held: HeldLock | null;
  /** The backend the lock was on when it was lost, until the lock is back. */
  private previous: PgBackend | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private beating = false;
  private stopped = false;
  private releasing: Promise<void> | null = null;

  private constructor(options: PgOwnerLockOptions, held: HeldLock) {
    this.options = options;
    this.deadlineMs = options.deadlineMs ?? Math.max(options.heartbeatMs, PgOwnerLock.MinDeadlineMs);
    this.held = held;
    this.timer = setInterval(() => void this.beat(), options.heartbeatMs);
    // A heartbeat must never be what keeps a process alive.
    this.timer.unref?.();
  }

  /** Takes the lock, or refuses at once with the schema that is taken. Never waits. */
  static async acquire(options: PgOwnerLockOptions): Promise<PgOwnerLock> {
    return new PgOwnerLock(options, await PgOwnerLock.take(options, null, 0));
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
      if (held) await this.drop(held, true);
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
          await PgOwnerLock.within(current.session.query(`SELECT 1`), this.deadlineMs);
          return;
        } catch {
          // `release` may have closed it under this check; then it is not ours to drop.
          if (this.stopped || this.held !== current) return;
          this.held = null;
          this.previous = current.backend;
          await this.drop(current, false);
        }
      }

      let taken: HeldLock;
      try {
        taken = await PgOwnerLock.take(this.options, this.previous, this.deadlineMs);
      } catch (error) {
        if (error instanceof PgOwnershipTakenError) {
          this.stopped = true;
          clearInterval(this.timer);
          this.options.lost(error);
        }
        // Anything else is the server being unreachable: the next beat tries again.
        return;
      }
      this.previous = null;
      if (this.stopped) await this.drop(taken, true);
      else this.held = taken;
    } finally {
      this.beating = false;
    }
  }

  /**
   * A new connection and the lock on it. Refused with `PgOwnershipTakenError`
   * only when another backend than `previous` holds it: `previous` is this
   * server's own lost connection, which the server has not noticed yet when a
   * partition heals, and is ended rather than taken for a rival.
   */
  private static async take(
    options: PgOwnerLockOptions,
    previous: PgBackend | null,
    deadlineMs: number
  ): Promise<HeldLock> {
    const connection = PgConnection.open({
      url: options.url,
      max: 1,
      applicationName: `${options.applicationName} owner`,
      connectTimeout: options.connectTimeout,
    });
    let session: PgReservedSession | null = null;
    try {
      session = await connection.reserve();
      const [row] = await session.query<{ held: boolean; pid: number; started: string }>(
        `SELECT pg_try_advisory_lock(hashtext('silo.owner'), hashtext($1)) AS held,
                pg_backend_pid() AS pid,
                (SELECT backend_start::text FROM pg_stat_activity WHERE pid = pg_backend_pid()) AS started`,
        [options.tables.schema]
      );
      const backend = { pid: Number(row.pid), started: row.started };
      if (!row.held && !(previous && (await PgOwnerLock.handOver(session, options, previous, deadlineMs)))) {
        throw new PgOwnershipTakenError(options.tables.schema);
      }
      return { connection, session, backend };
    } catch (error) {
      session?.release();
      await connection.close(0);
      throw error;
    }
  }

  /**
   * Ends `previous` when it is still the backend it was — same pid, same start
   * time, so never a stranger that reused the pid — and takes the lock once it
   * lets go. False when `previous` is gone, which means a rival holds the lock.
   */
  private static async handOver(
    session: PgReservedSession,
    options: PgOwnerLockOptions,
    previous: PgBackend,
    deadlineMs: number
  ): Promise<boolean> {
    const [found] = await session.query<{ ended: boolean }>(
      `SELECT pg_terminate_backend(pid) AS ended FROM pg_stat_activity
       WHERE pid = $1 AND backend_start = $2::timestamptz`,
      [previous.pid, previous.started]
    );
    if (!found) return false;
    // Found but not ended: the next beat tries again, rather than calling it lost.
    if (!found.ended) throw new PgUnavailableError("the previous owner session could not be ended", "busy");

    const until = Date.now() + Math.min(deadlineMs || PgOwnerLock.HandoverMs, PgOwnerLock.HandoverMs);
    for (;;) {
      const [row] = await session.query<{ held: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext('silo.owner'), hashtext($1)) AS held`,
        [options.tables.schema]
      );
      if (row.held) return true;
      // Still letting go: the next beat tries again, rather than calling it lost.
      if (Date.now() > until) throw new PgUnavailableError("the previous owner session is still ending", "busy");
      await Bun.sleep(50);
    }
  }

  /** Closes a lock connection, unlocking first when it may still be alive. Bounded, so a partition cannot hold a shutdown. */
  private async drop(held: HeldLock, unlock: boolean): Promise<void> {
    if (unlock) {
      try {
        await PgOwnerLock.within(held.session.query(`SELECT pg_advisory_unlock_all()`), this.deadlineMs);
      } catch {
        // The connection is already gone, and the lock went with it.
      }
    }
    held.session.release();
    await held.connection.close(0);
  }

  /** `work`, or a rejection once `ms` has passed. The timer holds no process open. */
  private static async within<T>(work: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("the owner lock's connection did not answer in time")), ms);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
