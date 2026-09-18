interface Waiter {
  resolve: (rows: any[]) => void;
  reject: (error: Error) => void;
}

/**
 * The one `Worker` every `SqliteReadWorker` in this process shares (D81).
 *
 * One thread rather than one per store, because a `Worker` is not cheap to
 * come and go: the test suite opens hundreds of stores, and one worker each
 * spawned 539 of them in a single run and took the runtime to 11 GB and a
 * crash — terminated workers are not fully released. The server opens one
 * store, so for it the two designs are the same; for everything else this one
 * is a single thread that stays for the life of the process, holding one
 * connection per database path and closing each on request.
 *
 * The worker's source is a string shipped as a `data:` URL for the reason the
 * plugin host's is (`WorkerSource`): a compiled binary cannot load a worker
 * module from outside its bundle. It speaks plain JSON: `{id, path, sql, args}`
 * or `{id, release: path}` in, `{id, rows}` or `{id, error}` out. `PRAGMA
 * query_only` on every connection means a bug here cannot become a second
 * writer (D25). Unref'd, so an idle thread never holds a CLI command open.
 */
export class SqliteReadThread {
  private static readonly ReleaseGraceMs = 2000;
  private static instance: SqliteReadThread | null = null;

  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<number, Waiter>();
  private sequence = 0;

  static shared(): SqliteReadThread {
    return (SqliteReadThread.instance ??= new SqliteReadThread());
  }

  /** Every row of `sql` bound to `args`, read on the connection for `path`. */
  async run(path: string, sql: string, args: readonly unknown[]): Promise<any[]> {
    await this.start();
    return this.send({ path, sql, args });
  }

  /**
   * Closes the connection for `path`, waiting for the worker to say it has —
   * `terminate` or a fire-and-forget message would return before the handle is
   * released, long enough for whatever removes the directory next to find the
   * file still open. Bounded, so a wedged worker cannot hang a close.
   */
  async release(path: string): Promise<void> {
    if (!this.worker) return;
    await Promise.race([
      this.send({ release: path }).catch(() => undefined),
      Bun.sleep(SqliteReadThread.ReleaseGraceMs),
    ]);
  }

  private send(message: Record<string, unknown>): Promise<any[]> {
    return new Promise<any[]>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("storage read thread is not running"));
        return;
      }
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...message });
    });
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const worker = new Worker(SqliteReadThread.url(), { type: "module" });
      this.worker = worker;
      worker.unref?.();
      let started = false;
      worker.addEventListener("message", (event: MessageEvent) => {
        const message: any = event.data;
        if (started) {
          this.answer(message);
          return;
        }
        if (message.ready) {
          started = true;
          resolve();
          return;
        }
        if (message.id === undefined) {
          const error = new Error(`storage read thread: ${message.error}`);
          reject(error);
          this.fail(error);
        }
      });
      worker.onerror = (event: any) => {
        const error = new Error(`storage read thread: ${event?.message ?? String(event)}`);
        reject(error);
        this.fail(error);
      };
    });
    return this.ready;
  }

  private answer(message: any): void {
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    if (message.error !== undefined) waiter.reject(new Error(message.error));
    else waiter.resolve(message.rows ?? []);
  }

  /** Fails every waiting read and drops the worker; the next read starts a new one. */
  private fail(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }

  private static url(): string {
    return "data:text/javascript;base64," + Buffer.from(SqliteReadThread.source(), "utf8").toString("base64");
  }

  private static source(): string {
    return [
      'import { Database } from "bun:sqlite";',
      "const handles = new Map();",
      "function open(path) {",
      "  let db = handles.get(path);",
      "  if (!db) {",
      "    db = new Database(path, { readwrite: true, create: false });",
      '    db.exec("PRAGMA busy_timeout = 5000");',
      '    db.exec("PRAGMA query_only = ON");',
      "    handles.set(path, db);",
      "  }",
      "  return db;",
      "}",
      "self.onmessage = (event) => {",
      "  const message = event.data;",
      "  if (message.release !== undefined) {",
      "    const db = handles.get(message.release);",
      "    if (db) { db.close(); handles.delete(message.release); }",
      "    self.postMessage({ id: message.id, rows: [] });",
      "    return;",
      "  }",
      "  let statement = null;",
      "  try {",
      "    statement = open(message.path).prepare(message.sql);",
      "    self.postMessage({ id: message.id, rows: statement.all(...message.args) });",
      "  } catch (caught) {",
      "    self.postMessage({ id: message.id, error: String((caught && caught.message) || caught) });",
      "  } finally {",
      "    if (statement) statement.finalize();",
      "  }",
      "};",
      "self.postMessage({ ready: true });",
    ].join("\n");
  }
}
