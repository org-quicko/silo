import { PgUnavailableError } from "./pg-unavailable-error";

/**
 * How many scans may hold a connection at once, and how many may wait.
 *
 * A list is a scan: a filter or a sort over `data` reads the whole collection,
 * and so does the count beside every page. Left to the pool, a flood of slow
 * filters would take every connection and a write would queue behind them.
 * Gated to all but two, a flood slows listing and search and nothing else,
 * which is the promise D81's read thread makes on SQLite; past `queue` more
 * waiting, a scan is refused as `503 busy` rather than queued behind the flood.
 */
export class PgScanGate {
  /** SQLite's read thread sheds at the same depth. */
  static readonly DefaultQueue = 64;

  private readonly limit: number;
  private readonly queue: number;
  private readonly waiting: { admit: () => void; refuse: (error: Error) => void }[] = [];
  private active = 0;
  private shed = 0;
  private closed = false;

  constructor(limit: number, queue: number = PgScanGate.DefaultQueue) {
    this.limit = Math.max(1, Math.floor(limit));
    this.queue = Math.max(0, Math.floor(queue));
  }

  /** Scans for a pool of `size`: all but the two kept for writes, and at least one. */
  static forPool(size: number, queue?: number): PgScanGate {
    return new PgScanGate(size - 2, queue);
  }

  async run<T>(scan: () => Promise<T>): Promise<T> {
    await this.enter();
    try {
      return await scan();
    } finally {
      this.leave();
    }
  }

  /** Refuses every scan still waiting, and every scan after. */
  close(): void {
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) waiter.refuse(PgScanGate.shuttingDown());
  }

  stats(): { scans_active: number; scans_waiting: number; shed: number } {
    return { scans_active: this.active, scans_waiting: this.waiting.length, shed: this.shed };
  }

  private enter(): Promise<void> {
    if (this.closed) return Promise.reject(PgScanGate.shuttingDown());
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.queue) {
      this.shed += 1;
      return Promise.reject(
        new PgUnavailableError("too many reads are waiting on storage; retry shortly", "busy")
      );
    }
    return new Promise((admit, refuse) => this.waiting.push({ admit, refuse }));
  }

  /** Hands the slot straight to the next waiter, so it cannot be taken in between. */
  private leave(): void {
    const next = this.waiting.shift();
    if (next) next.admit();
    else this.active -= 1;
  }

  private static shuttingDown(): PgUnavailableError {
    return new PgUnavailableError("storage is shutting down", "busy");
  }
}
