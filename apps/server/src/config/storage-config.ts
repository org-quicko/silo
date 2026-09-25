/**
 * `[storage]`: which adapter holds the instance, and where.
 *
 * `path` is the data directory for every driver. With `postgres` the content
 * moves into the database, but the directory still holds the run file, logs,
 * plugins, transfer staging and fs media — local state, not content. The rest
 * are read by the `postgres` driver alone; durations are in seconds, and `0`
 * turns a timeout off (docs/design/storage.md §6.6).
 */
export interface StorageConfig {
  driver: string;
  path: string;
  /** A `postgres://` URL. A secret: it may carry the password, so it is never
   *  reported back in full. */
  url?: string;
  /** The schema silo's tables live in. */
  schema: string;
  pool_size: number;
  /** One connection attempt. */
  connect_timeout: number;
  /** How long a start keeps retrying an unreachable server. */
  startup_wait: number;
  /** An idle pooled connection is closed after this long. */
  idle_timeout: number;
  /** A pooled connection is replaced after this long, whatever it is doing. */
  max_lifetime: number;
  /** One statement's ceiling, enforced by the server. */
  statement_timeout: number;
  /** A transaction left open this long without a statement is ended by the server. */
  idle_in_transaction_timeout: number;
}
