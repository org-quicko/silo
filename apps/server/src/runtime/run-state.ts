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
}
