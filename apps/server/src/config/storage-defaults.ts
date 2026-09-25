/** `[storage]`'s Postgres defaults, and how a value outside the range reads. */
export class StorageDefaults {
  static readonly Schema = "silo";
  static readonly PoolSize = 10;
  static readonly ConnectTimeout = 10;
  /** Long enough for a container's Postgres to come up after silo does. */
  static readonly StartupWait = 60;
  /** Shorter than the idle cut-off of most proxies and serverless databases. */
  static readonly IdleTimeout = 60;
  /** Rotates connections, so a failover or a DNS change is picked up. */
  static readonly MaxLifetime = 1800;
  static readonly StatementTimeout = 30;
  static readonly IdleInTransactionTimeout = 60;

  /** Seconds, or the fallback when the value is not a number of seconds.
   *  `0` is kept: it means "no limit". */
  static seconds(value: number, fallback: number): number {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  /** A whole number of connections, at least one. */
  static poolSize(value: number, fallback: number): number {
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
  }
}
