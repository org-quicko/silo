import { ValidationError } from "@silo/shared/validation-error";
import { ConflictError } from "../../../core/errors/conflict-error";
import { NotFoundError } from "../../../core/errors/not-found-error";
import { PgUnavailableError } from "./pg-unavailable-error";

/**
 * A driver error, as the error the rest of silo already answers.
 *
 * Read by field rather than by class, so this file does not import the driver:
 * Bun puts the SQLSTATE in `errno` and its own label in `code`. Anything not
 * listed passes through unchanged and becomes a 500, which is the right answer
 * for a bug in the SQL (docs/design/storage.md §6.6).
 */
export class PgErrorMap {
  /**
   * Bun's labels for a connection that broke. `EXPECTED_REQUEST` is what a
   * statement inside a transaction sees when its backend is killed.
   */
  private static readonly ConnectionLost = new Set([
    "ERR_POSTGRES_CONNECTION_CLOSED",
    "ERR_POSTGRES_CONNECTION_TIMEOUT",
    "ERR_POSTGRES_IDLE_TIMEOUT",
    "ERR_POSTGRES_LIFETIME_TIMEOUT",
    "ERR_POSTGRES_EXPECTED_REQUEST",
  ]);

  /** SQLSTATEs that say "not now" rather than "no", by what may be done about it. */
  private static readonly States: Record<string, PgUnavailableError["failure"]> = {
    "57014": "busy", // statement timeout
    "53300": "busy", // too many connections
    "57P01": "connection", // admin shutdown, or pg_terminate_backend
    "57P02": "connection", // crash shutdown
    "57P03": "unreachable", // the server is starting up
    "40001": "contention", // serialization failure
    "40P01": "contention", // deadlock
  };

  static translate(error: unknown): unknown {
    if (!PgErrorMap.isDriverError(error)) return error;
    const state = PgErrorMap.state(error);

    if (state === "23505") {
      return new ConflictError("a record with that name or id already exists");
    }
    if (state === "23503") return PgErrorMap.foreignKey(error);
    // A NUL in a text parameter, or a string jsonb cannot hold. Entry data is
    // refused before it gets here (D92), so this is a filter value or a name.
    if (state === "22021" || state === "22P05") {
      return new ValidationError("the request holds a NUL character, which storage cannot hold");
    }

    const failure = PgErrorMap.failure(error, state);
    if (failure) return new PgUnavailableError(PgErrorMap.describe(failure), failure);
    return error;
  }

  /** Why storage is unavailable, or null when this is not that kind of error. */
  private static failure(error: Error, state: string): PgUnavailableError["failure"] | null {
    const label = PgErrorMap.label(error);
    if (label === "ERR_POSTGRES_CONNECTION_REFUSED") return "unreachable";
    if (PgErrorMap.ConnectionLost.has(label) || state.startsWith("08")) return "connection";
    return Object.hasOwn(PgErrorMap.States, state) ? PgErrorMap.States[state] : null;
  }

  private static describe(failure: PgUnavailableError["failure"]): string {
    if (failure === "busy") return "storage is busy; retry shortly";
    if (failure === "unreachable") return "storage cannot be reached; retry shortly";
    return "storage is unavailable; retry shortly";
  }

  /** True for an error the driver raised, which is the only kind translated. */
  private static isDriverError(error: unknown): error is Error {
    return error instanceof Error && PgErrorMap.label(error).startsWith("ERR_POSTGRES_");
  }

  private static state(error: Error): string {
    const errno = (error as { errno?: unknown }).errno;
    return typeof errno === "string" ? errno : "";
  }

  private static label(error: Error): string {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : "";
  }

  /**
   * A foreign key refused the write. Inserting under a parent that is gone
   * means the caller named something that no longer exists; deleting a parent
   * that still has children means something is in the way.
   */
  private static foreignKey(error: Error): Error {
    if (error.message.startsWith("update or delete")) {
      return new ConflictError("the record still has content beneath it");
    }
    return new NotFoundError("the collection or scope this write names no longer exists");
  }
}
