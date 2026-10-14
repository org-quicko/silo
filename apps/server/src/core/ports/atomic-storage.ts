import type { ChangeSet } from "./change-set";
import type { Storage } from "./storage";

/**
 * A `Storage` that can apply many writes as one (D107).
 *
 * Optional and asked of the store, like `IndexedStorage`: SQLite and Postgres
 * offer it, the fs adapter does not, and an operation that needs it is refused
 * there rather than run as separate writes.
 */
export interface AtomicStorage extends Storage {
  /**
   * Checks every precondition, then makes every write, in one transaction:
   * all of it lands or none of it does, and no reader sees anything between.
   * A precondition that no longer holds is a `CommitConflictError`, thrown
   * before anything is written. A `StorageBusyError` can mean the outcome is
   * unknown; read the guard row back before trying again.
   */
  commit(changes: ChangeSet): Promise<void>;
}
