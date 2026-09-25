import type { Storage } from "./storage";
import type { StorageMeasurement } from "./storage-measurement";

/**
 * A `Storage` that can report on itself for the observability snapshot.
 *
 * `StorageMetrics` measures the data directory by walking it, which says
 * nothing about a store that lives in a database. Such a store offers this
 * instead. Optional and asked of the store, like `IndexedStorage`.
 */
export interface MeasuredStorage extends Storage {
  /** Called in the background at most once per sampling interval, never per request. */
  measure(): Promise<StorageMeasurement>;
}
