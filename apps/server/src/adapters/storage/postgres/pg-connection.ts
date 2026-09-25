import { SQL } from "bun";
import { PgErrorMap } from "./pg-error-map";
import type { PgParameter, PgQueryable } from "./pg-queryable";

/** How to open a pool. */
export interface PgConnectionOptions {
  url: string;
  /** Connections the pool may hold at once. */
  max: number;
  /** What `pg_stat_activity` shows, so an operator can tell silo's sessions apart. */
  applicationName: string;
}

/** One connection taken out of the pool until `release` is called. */
export interface PgReservedSession extends PgQueryable {
  release(): void;
}

/**
 * The pool, and the only file that imports the driver.
 *
 * Two rules from the P0 measurements live here so no store has to remember
 * them (docs/design/storage.md §6.6):
 *
 * - `prepare: false`. The driver otherwise keeps every distinct statement text
 *   prepared on its session, and a compiled filter has a new text nearly every
 *   call, so backend memory would grow with the workload. Parameters are still
 *   bound.
 * - Every error leaves through `PgErrorMap`, so a caller sees a `ConflictError`
 *   or a `StorageBusyError` rather than a driver type.
 *
 * Swapping the driver means rewriting this file and nothing else.
 */
export class PgConnection implements PgQueryable {
  private readonly sql: SQL;
  private closing: Promise<void> | null = null;

  private constructor(sql: SQL) {
    this.sql = sql;
  }

  /** Lazy: nothing connects until the first statement. */
  static open(options: PgConnectionOptions): PgConnection {
    return new PgConnection(
      new SQL({
        url: options.url,
        max: options.max,
        prepare: false,
        connection: { application_name: options.applicationName },
      })
    );
  }

  async query<Row = any>(text: string, params: readonly PgParameter[] = []): Promise<Row[]> {
    return PgConnection.run<Row>(this.sql, text, params);
  }

  /**
   * `work` inside one transaction on one connection: committed when it
   * resolves, rolled back when it throws.
   *
   * `work` must await nothing but its own statements. A transaction held open
   * across a hook or a blob write holds a connection and its row locks for as
   * long as that takes.
   */
  async transaction<T>(work: (session: PgQueryable) => Promise<T>): Promise<T> {
    try {
      const result = await this.sql.begin(async (transaction) =>
        work({
          query: (text, params = []) => PgConnection.run(transaction, text, params),
        })
      );
      return result as T;
    } catch (error) {
      throw PgErrorMap.translate(error);
    }
  }

  /**
   * A connection of its own, for state that lives on a session rather than in
   * a transaction — the owner lock. If the connection drops, the next
   * statement on it fails rather than silently running on a new one.
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

  /** Waits up to five seconds for statements in flight, then drops them.
   *  Safe to call more than once. */
  async close(): Promise<void> {
    this.closing ??= this.sql.close({ timeout: 5 });
    await this.closing;
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
