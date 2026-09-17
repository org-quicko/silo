import { Readable } from "node:stream";
import { createGzip, type Gzip } from "node:zlib";

/**
 * Gzip that a producer can be paced by.
 *
 * The web `CompressionStream` cannot be: it accepts every chunk it is offered
 * and holds the result, so bytes streamed through it peaked at the size of the
 * whole input — 583 MB for 500 MB of blobs, measured, against 67 MB for the
 * same bytes through the tar writer alone. `node:zlib` answers `false` from
 * `write` when its buffer is full and emits `drain` when it is not, which is
 * the signal a walk needs and the one the web stream never gives.
 *
 * See §7.1 in
 * [docs/design/transfer.md](../../../../../../docs/design/transfer.md).
 */
export class GzipStream {
  private readonly gzip: Gzip;
  private readonly out: ReadableStream<Uint8Array>;
  private broken: Error | null = null;

  constructor() {
    this.gzip = createGzip();
    // A consumer that walks away destroys the stream. Recording that is what
    // lets `write` below unwind the walk instead of waiting for a `drain` that
    // can no longer arrive.
    this.gzip.on("error", (error: Error) => {
      this.broken ??= error;
    });
    this.gzip.on("close", () => {
      this.broken ??= new Error("gzip stream closed");
    });
    this.out = Readable.toWeb(this.gzip) as ReadableStream<Uint8Array>;
  }

  /**
   * Resolves once zlib has room for more.
   *
   * Each of the three outcomes removes the other two listeners. Attaching them
   * per write and leaving the losers behind is a leak that announces itself at
   * eleven — `MaxListenersExceededWarning` — and by then a long export has
   * thousands.
   */
  async write(chunk: Uint8Array): Promise<void> {
    if (this.broken) throw this.broken;
    if (this.gzip.write(chunk)) return;

    await new Promise<void>((resolve) => {
      const settle = () => {
        this.gzip.off("drain", settle);
        this.gzip.off("error", settle);
        this.gzip.off("close", settle);
        resolve();
      };
      this.gzip.once("drain", settle);
      this.gzip.once("error", settle);
      this.gzip.once("close", settle);
    });

    if (this.broken) throw this.broken;
  }

  /** No more input; the readable ends once the tail is flushed. */
  end(): void {
    if (!this.broken) this.gzip.end();
  }

  /** Tears the stream down so the consumer sees the failure rather than a
   *  body that simply stops. */
  fail(error: unknown): void {
    this.gzip.destroy(error instanceof Error ? error : new Error(String(error)));
  }

  /** The compressed bytes, for a response body or a file. */
  get readable(): ReadableStream<Uint8Array> {
    return this.out;
  }
}
