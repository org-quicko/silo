import { ValidationError } from "@silo/shared/validation-error";
import { ConflictError } from "../../../core/errors/conflict-error";
import { NotFoundError } from "../../../core/errors/not-found-error";
import { StorageBusyError } from "../../../core/errors/storage-busy-error";

/**
 * A driver error, as the error the rest of silo already answers.
 *
 * Read by field rather than by class, so this file does not import the driver:
 * Bun puts the SQLSTATE in `errno` and its own label in `code`. Anything not
 * listed passes through unchanged and becomes a 500, which is the right answer
 * for a bug in the SQL (docs/design/storage.md §6.6).
 */
export class PgErrorMap {
  /** Bun's labels for a connection that is gone or never came up. */
  private static readonly ConnectionLost = new Set([
    "ERR_POSTGRES_CONNECTION_CLOSED",
    "ERR_POSTGRES_CONNECTION_TIMEOUT",
    "ERR_POSTGRES_IDLE_TIMEOUT",
    "ERR_POSTGRES_LIFETIME_TIMEOUT",
  ]);

  /**
   * SQLSTATEs that say "not now" rather than "no": a statement timeout, too
   * many connections, a server shutting down, a serialization failure or a
   * deadlock. Each is a 503 with a retry hint.
   */
  private static readonly Unavailable = new Set([
    "57014",
    "53300",
    "57P01",
    "57P02",
    "57P03",
    "40001",
    "40P01",
  ]);

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
    if (
      PgErrorMap.Unavailable.has(state) ||
      state.startsWith("08") ||
      PgErrorMap.ConnectionLost.has(PgErrorMap.label(error))
    ) {
      return new StorageBusyError("storage is unavailable; retry shortly");
    }
    return error;
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
