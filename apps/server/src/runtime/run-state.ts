/**
 * What a running silo records about itself in the data directory, so that
 * `silo status`, `silo stop` and a second `silo serve` can find it.
 *
 * Written by every `serve`, foreground or detached — the guard against two
 * processes on one data directory has to cover the common development case,
 * not only the daemon.
 */
export interface RunState {
  pid: number;
  version: string;
  /** The address actually bound, not what the config said — a `silo status`
   *  run without the original flags would otherwise report the wrong port. */
  listen: string;
  data: string;
  driver: string;
  /** Where this process is writing its log, if anywhere. */
  log?: string;
  started_at: string;
  /**
   * The boot this record was written in, where the platform says (D82). A
   * record from another boot is stale whatever its pid points at now.
   */
  boot_id?: string;
  /**
   * When the server last refreshed this record (D82). Refreshed every
   * `RunFile.HeartbeatMs`; a record nobody has touched for
   * `RunFile.StaleAfterMs` is a server that died without removing it, however
   * alive its recycled pid looks. Absent from records older versions wrote,
   * which are judged by their pid alone as before.
   */
  heartbeat_at?: string;
}
