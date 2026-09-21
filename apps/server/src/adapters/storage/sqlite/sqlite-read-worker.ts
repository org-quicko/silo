import { StorageBusyError } from "../../../core/errors/storage-busy-error";
import { SqliteReadThread } from "./sqlite-read-thread";

/**
 * A store's handle on the shared read thread: a second connection to its
 * database, on another thread, for the reads whose cost is decided by the
 * caller (D81).
 *
 * `bun:sqlite` is synchronous, so a filter over a large collection held the one
 * JS thread for as long as the scan took — 0.6 s for one `contains` over
 * 200,000 rows, 12 s for a 49-way `or` of them, measured — and nothing else was
 * served meanwhile. Here the statement runs on `SqliteReadThread` over the
 * thread's own connection to this file (WAL lets it read while the main
 * connection writes), the main thread awaits the rows, and a flood of slow
 * reads queues here up to `MaxPending` and is then refused as `503` rather
 * than taken on.
 *
 * One caution for tests, not for the server: under `bun test`, a promise that
 * waits on this worker must be awaited or settled *before* it is handed to
 * `expect(...).rejects` or `.resolves` — see the Tests section of
 * docs/context/code-design.md.
 */
export class SqliteReadWorker {
  /** Reads waiting on the thread before the next one is refused. */
  static readonly MaxPending = 64;

  private readonly filePath: string;
  private readonly thread: SqliteReadThread;
  /** Reads accepted and not yet answered. */
  private inflight = 0;
  private closed = false;

  private constructor(filePath: string, thread: SqliteReadThread) {
    this.filePath = filePath;
    this.thread = thread;
  }

  /** `null` for a database only this process can see — another thread could not open it. */
  static for(filePath: string): SqliteReadWorker | null {
    if (filePath === ":memory:" || filePath === "") return null;
    return new SqliteReadWorker(filePath, SqliteReadThread.shared());
  }

  /** Every row of `sql` bound to `args`, read on the thread's connection. */
  async all(sql: string, args: readonly unknown[]): Promise<any[]> {
    if (this.closed) throw new Error("storage is closed");
    if (this.inflight >= SqliteReadWorker.MaxPending) {
      throw new StorageBusyError(
        `${this.inflight} reads are already waiting on storage; retry shortly`
      );
    }
    this.inflight++;
    try {
      return await this.thread.run(this.filePath, sql, args);
    } finally {
      this.inflight--;
    }
  }

  /** Refuses further reads and has the thread close its connection to this file. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.thread.release(this.filePath);
  }
}
