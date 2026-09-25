import { StorageBusyError } from "../../../core/errors/storage-busy-error";

/**
 * Postgres could not answer now: a `503` with `Retry-After`, like any
 * `StorageBusyError`, that also says why — which is what decides whether the
 * adapter may try again itself (docs/design/storage.md §6.6).
 *
 * - `connection`: the connection broke. Safe to retry when nothing can have
 *   committed.
 * - `contention`: a serialization failure or a deadlock. The server rolled the
 *   transaction back, so it is always safe to retry.
 * - `unreachable`: no connection could be made, or the server is starting up.
 * - `busy`: a statement timed out, or the server has no connection to spare.
 * - `unknown`: the connection broke while a commit was in flight, so the write
 *   may or may not have landed. Never retried.
 */
export class PgUnavailableError extends StorageBusyError {
  readonly failure: "connection" | "contention" | "unreachable" | "busy" | "unknown";

  constructor(message: string, failure: PgUnavailableError["failure"]) {
    super(message);
    this.failure = failure;
  }
}
