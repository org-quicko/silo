import type { Storage } from "./storage";

/**
 * A `Storage` that can make sure only one server writes to it (D25).
 *
 * `RunFile` does that for a data directory. A store whose data lives somewhere
 * two directories can share — a database — needs its own guard, and offers it
 * here; `serve` claims it before anything is written. Optional and asked of the
 * store, like `IndexedStorage`.
 */
export interface OwnedStorage extends Storage {
  /**
   * Takes ownership for as long as the store is open, or refuses at once when
   * another server holds it. `lost` is called if ownership is lost later and
   * another server has taken it; the caller must then stop.
   */
  claimOwnership(lost: (reason: Error) => void): Promise<void>;
}
