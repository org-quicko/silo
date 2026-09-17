import type { Context } from "hono";
import { ValidationError } from "@silo/shared/validation-error";
import { ConflictError } from "../../core/errors/conflict-error";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { UnauthorizedError } from "../../core/errors/unauthorized-error";
import type { ImportProgress } from "../../core/transfer/import-progress";
import type { ImportResult } from "../../core/transfer/import-result";

/**
 * An import or copy answered as a line-delimited progress stream.
 *
 * Both operations spend their whole run saying nothing — the request body is in
 * long before the destination has finished writing — so on any connection that
 * closes when it goes quiet they die at exactly the point they were succeeding.
 * A heartbeat is what makes the operation's own length harmless, and the
 * progress it carries is what makes the wait legible instead of merely
 * survivable. See §7.8 in
 * [docs/design/transfer.md](../../../../../docs/design/transfer.md).
 *
 * **The status is 200 before the work begins**, because that is what sending
 * the first byte early costs. A failure is the `error` line instead, and a
 * caller reads the last line rather than the status. It is therefore opt-in:
 * `Accept: application/x-ndjson` on the request, and nothing else changes.
 */
export class ProgressStream {
  static readonly ContentType = "application/x-ndjson";

  /** Milliseconds of silence before a bare heartbeat goes out. */
  static readonly HeartbeatMs = 1000;

  /** Whether this request asked for one. */
  static wanted(c: Context): boolean {
    return (c.req.header("Accept") || "").includes(ProgressStream.ContentType);
  }

  /**
   * Runs `work`, streaming a line per progress report and a final `result` or
   * `error` line.
   *
   * `work` is started before the first heartbeat so nothing is delayed by the
   * reporting, and the heartbeat interval is cleared on every exit path.
   */
  static respond(
    c: Context,
    work: (report: (progress: ImportProgress) => void) => Promise<ImportResult>
  ): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    let lastLine = Date.now();
    const line = (value: unknown) => {
      lastLine = Date.now();
      // Not awaited: a report must never block the import that produced it,
      // and the writer queues in order.
      void writer.write(encoder.encode(`${JSON.stringify(value)}\n`)).catch(() => {});
    };

    const heartbeat = setInterval(() => {
      if (Date.now() - lastLine >= ProgressStream.HeartbeatMs) {
        line({ type: "progress", phase: "working" });
      }
    }, ProgressStream.HeartbeatMs);

    void (async () => {
      try {
        const result = await work((progress) =>
          line({ type: "progress", phase: progress.phase, result: progress.result })
        );
        line({ type: "result", result });
      } catch (caught) {
        line(ProgressStream.failure(caught));
      } finally {
        clearInterval(heartbeat);
        await writer.close().catch(() => {});
      }
    })();

    c.header("Content-Type", ProgressStream.ContentType);
    // Nothing downstream may collect this into a buffer and hand it over at the
    // end; that would undo the one thing it is for.
    c.header("Cache-Control", "no-store");
    c.header("X-Accel-Buffering", "no");
    return c.body(readable);
  }

  /**
   * The same `{code, message}` body the ordinary handler produces, one line
   * down, with the status it would have set.
   *
   * Only the refusals a transfer can actually reach are named; anything else is
   * a 500 with its own message rather than the handler's flat "internal error",
   * because here the line *is* the whole answer and there is no status left to
   * carry meaning.
   */
  private static failure(caught: unknown): unknown {
    const at = (status: number, code: string) => ({
      type: "error",
      status,
      error: { code, message: (caught as Error).message },
    });
    if (ValidationError.is(caught)) return at(400, "validation_failed");
    if (caught instanceof ConflictError) return at(409, "conflict");
    if (caught instanceof ForbiddenError) return at(403, "forbidden");
    if (caught instanceof UnauthorizedError) return at(401, "unauthorized");
    return {
      type: "error",
      status: 500,
      error: {
        code: "internal",
        message: caught instanceof Error ? caught.message : "transfer failed",
      },
    };
  }
}
