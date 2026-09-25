import { SQL } from "bun";
import { PgErrorMap } from "./pg-error-map";
import type { PgParameter, PgQueryable } from "./pg-queryable";
import { PgUnavailableError } from "./pg-unavailable-error";

/** How to open a pool. Durations are in seconds, and `0` turns one off. */
export interface PgConnectionOptions {
  url: string;
  /** Connections the pool may hold at once. */
  max: number;
  /** What `pg_stat_activity` shows, so an operator can tell silo's sessions apart. */
  applicationName: string;
  connectTimeout?: number;
  idleTimeout?: number;
  maxLifetime?: number;
  statementTimeout?: number;
  idleInTransactionTimeout?: number;
}

/** One connection taken out of the pool until `release` is called. */
export interface PgReservedSession extends PgQueryable {
  release(): void;
}

/** What the pool has been doing, for the observability snapshot. */
export interface PgConnectionStats {
  size: number;
  in_use: number;
  retries: number;
  failures: number;
}

/**
 * The pool, and the only file that imports the driver.
 *
 * The rules from the P0 and P3 measurements live here so no store has to
 * remember them (docs/design/storage.md §6.6):
 *
 * - `prepare: false`. The driver otherwise keeps every distinct statement text
 *   prepared on its session, and a compiled filter has a new text nearly every
 *   call, so backend memory would grow with the workload.
 * - Every error leaves through `PgErrorMap`, so a caller sees a `ConflictError`
 *   or a `PgUnavailableError` rather than a driver type.
 * - A broken connection is retried when nothing can have committed: a read,
 *   or a transaction whose `work` had not finished. A serialization failure or
 *   a deadlock is retried too, since the server rolled it back. A connection
 *   lost while a commit was in flight is never retried — the write may have
 *   landed — and becomes a `503` saying so.
 * - `close` drains: the driver's own close drops statements in flight, so
 *   new work is refused and the work already running gets a grace period.
 *
 * Swapping the driver means rewriting this file and nothing else.
 */
export class PgConnection implements PgQueryable {
  /** One try and three retries. */
  static readonly Attempts = 4;

  private readonly sql: SQL;
  private readonly size: number;
  private active = 0;
  private retries = 0;
  private failures = 0;
  private closing: Promise<void> | null = null;
  private drained: (() => void) | null = null;

  private constructor(sql: SQL, size: number) {
    this.sql = sql;
    this.size = size;
  }

  /** Lazy: nothing connects until the first statement. */
  static open(options: PgConnectionOptions): PgConnection {
    const connection: Record<string, string | number> = {
      application_name: options.applicationName,
    };
    // Server-side limits, in the milliseconds Postgres counts in. There is no
    // `client_connection_check_interval`: a Windows server refuses it at
    // connect, and `statement_timeout` already bounds a query whose client left.
    if (options.statementTimeout !== undefined) {
      connection.statement_timeout = Math.round(options.statementTimeout * 1000);
    }
    if (options.idleInTransactionTimeout !== undefined) {
      connection.idle_in_transaction_session_timeout = Math.round(
        options.idleInTransactionTimeout * 1000
      );
    }

    return new PgConnection(
      new SQL({
        url: options.url,
        max: options.max,
        prepare: false,
        ...(options.connectTimeout ? { connectionTimeout: options.connectTimeout } : {}),
        idleTimeout: options.idleTimeout ?? 0,
        maxLifetime: options.maxLifetime ?? 0,
        connection,
      }),
      options.max
    );
  }

  /** A statement on the pool. A `SELECT` is retried when its connection broke. */
  async query<Row = any>(text: string, params: readonly PgParameter[] = []): Promise<Row[]> {
    const retryable = /^\s*SELECT\b/i.test(text);
    return this.tracked(() =>
      this.attempting((failure) => retryable && failure === "connection", () =>
        PgConnection.run<Row>(this.sql, text, params)
      )
    );
  }

  /**
   * `work` inside one transaction on one connection: committed when it
   * resolves, rolled back when it throws, and retried by the rules above — so
   * `work` must be safe to run again from the start.
   *
   * `work` must await nothing but its own statements. A transaction held open
   * across a hook or a blob write holds a connection and its row locks for as
   * long as that takes.
   */
  async transaction<T>(work: (session: PgQueryable) => Promise<T>): Promise<T> {
    return this.tracked(async () => {
      for (let attempt = 1; ; attempt += 1) {
        let committing = false;
        try {
          const result = await this.sql.begin(async (transaction) => {
            const value = await work({
              query: (text, params = []) => PgConnection.run(transaction, text, params),
            });
            committing = true;
            return value;
          });
          return result as T;
        } catch (caught) {
          const error = PgErrorMap.translate(caught);
          const failure = error instanceof PgUnavailableError ? error.failure : null;
          if (committing && failure === "connection") {
            this.failures += 1;
            throw new PgUnavailableError(
              "the connection to storage broke while this write was being committed, so it may or may not have been saved; read it back before trying again",
              "unknown"
            );
          }
          const retry = failure === "contention" || failure === "connection";
          if (!retry || attempt >= PgConnection.Attempts) {
            if (failure) this.failures += 1;
            throw error;
          }
          this.retries += 1;
          await PgConnection.backoff(attempt);
        }
      }
    });
  }

  /**
   * A connection of its own, for state that lives on a session rather than in
   * a transaction — the owner lock. If the connection drops, the next
   * statement on it fails rather than silently running on a new one. Never
   * retried, for that reason.
   */
  async reserve(): Promise<PgReservedSession> {
    let reserved: Awaited<ReturnType<SQL["reserve"]>>;
    try {
      reserved = await this.sql.reserve();
    } catch (error) {
      throw PgErrorMap.translate(error);
    }
    return {
      query: (text, params = []) => PgConnection.run(reserved, text, params),
      release: () => reserved.release(),
    };
  }

  stats(): PgConnectionStats {
    return {
      size: this.size,
      in_use: this.active,
      retries: this.retries,
      failures: this.failures,
    };
  }

  /**
   * Refuses new work, waits up to `graceMs` for the work already running, then
   * closes every connection. Safe to call more than once.
   */
  async close(graceMs: number = 4_000): Promise<void> {
    this.closing ??= (async () => {
      if (this.active > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          new Promise<void>((resolve) => (this.drained = resolve)),
          new Promise<void>((resolve) => (timer = setTimeout(resolve, graceMs))),
        ]);
        clearTimeout(timer);
      }
      await this.sql.close({ timeout: 1 });
    })();
    await this.closing;
  }

  /** Counts `work` as in flight, so `close` can wait for it. */
  private async tracked<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) {
      throw new PgUnavailableError("storage is shutting down", "busy");
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      if (this.active === 0) this.drained?.();
    }
  }

  /** `run`, retried while `retryable` says so and attempts remain. */
  private async attempting<T>(
    retryable: (failure: PgUnavailableError["failure"]) => boolean,
    run: () => Promise<T>
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const failure = error instanceof PgUnavailableError ? error.failure : null;
        if (!failure || !retryable(failure) || attempt >= PgConnection.Attempts) {
          if (failure) this.failures += 1;
          throw error;
        }
        this.retries += 1;
        await PgConnection.backoff(attempt);
      }
    }
  }

  /** About 50, 100 and 200 milliseconds, jittered so retries do not arrive together. */
  private static backoff(attempt: number): Promise<void> {
    return Bun.sleep(25 * 2 ** attempt * (0.5 + Math.random()));
  }

  private static async run<Row>(
    sql: SQL,
    text: string,
    params: readonly PgParameter[]
  ): Promise<Row[]> {
    try {
      return (await sql.unsafe(text, [...params])) as Row[];
    } catch (error) {
      throw PgErrorMap.translate(error);
    }
  }
}
