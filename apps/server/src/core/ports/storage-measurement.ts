/** What a store that lives outside the data directory reports about itself. */
export interface StorageMeasurement {
  /** Bytes its tables and indexes take, or null when it cannot say. */
  bytes: number | null;
  /** Its connection pool, when it keeps one. */
  pool: {
    size: number;
    in_use: number;
    scans_active: number;
    scans_waiting: number;
    /** Scans refused as `503 busy` since the start. */
    shed: number;
    /** Statements and transactions tried again since the start. */
    retries: number;
    /** Calls that failed as unavailable since the start. */
    failures: number;
  } | null;
  /** Whether this process owns the store (`OwnedStorage`); null when it has no owner lock. */
  owner: "held" | "retaking" | "lost" | "not_claimed" | null;
  /**
   * What the connection asked of TLS, and the protocol a session actually
   * uses (`TLSv1.3`), or null when it is not encrypted or could not be read.
   * Null when the store keeps no connection.
   */
  tls: { mode: string; protocol: string | null } | null;
}
