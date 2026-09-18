import fs from "fs/promises";
import path from "path";
import { BootId } from "./boot-id";
import { Daemon } from "./daemon";
import type { RunState } from "./run-state";

/** Whether a record names a server that is still running, and if not, why not. */
export type RunLiveness = { live: true } | { live: false; reason: string };

/** What `liveness` compares a record against; overridable for tests. */
export interface LivenessClock {
  now?: number;
  pid?: number;
  bootId?: string;
}

/**
 * `<data dir>/silo.run.json` — the record a running server leaves behind.
 *
 * One file, not the conventional pair of a bare `silo.pid` plus a sidecar of
 * everything else. `silo status` has to report the address that was actually
 * bound, and re-deriving it from configuration would lie the moment a server
 * was started with `--listen`; keeping the pid and that context together means
 * there is one thing to write, one to read, and one to delete. `silo stop` is
 * the supported way to signal it, so nothing outside silo needs to parse it.
 *
 * **Staleness** is decided by identity, not by trusting the file and not by the
 * pid alone (D82). A record is stale when it names *this* process (a
 * predecessor with our pid, which under Docker is always 1), when it was
 * written in another boot, when its pid is gone, or when the server that wrote
 * it has not refreshed it for `StaleAfterMs` — a live server does so every
 * `HeartbeatMs`. Only then does a pid that exists count as a live server. The
 * residual hazard is a pid recycled within the stale window, which is why
 * `stop` reports what it signalled rather than doing it silently.
 */
export class RunFile {
  static readonly Name = "silo.run.json";

  /** How often a running server refreshes its record. */
  static readonly HeartbeatMs = 30_000;

  /** How long a record may go unrefreshed before it is a dead server's. Four
   *  missed beats: a pause that long is a server nothing else would call up. */
  static readonly StaleAfterMs = 120_000;

  static pathFor(dataDir: string): string {
    return path.join(dataDir, RunFile.Name);
  }

  /**
   * Written through a temporary sibling and a rename, so a reader — including
   * a `serve` deciding whether to start — sees the old record or the new one
   * and never a torn one it would read as "no record".
   */
  static async write(dataDir: string, state: RunState): Promise<void> {
    await fs.mkdir(dataDir, { recursive: true });
    const target = RunFile.pathFor(dataDir);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2) + "\n", "utf8");
    await fs.rename(temporary, target);
  }

  /** The record with a fresh `heartbeat_at`, written back. */
  static async heartbeat(dataDir: string, state: RunState): Promise<RunState> {
    const refreshed = { ...state, heartbeat_at: new Date().toISOString() };
    await RunFile.write(dataDir, refreshed);
    return refreshed;
  }

  /** The record as written, whether or not the process it names still exists. */
  static async read(dataDir: string): Promise<RunState | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(RunFile.pathFor(dataDir), "utf8"));
      if (!parsed || typeof parsed.pid !== "number") return null;
      return parsed as RunState;
    } catch {
      // Absent, unreadable, or truncated by a crash mid-write — all of which
      // mean the same thing to every caller: no usable record.
      return null;
    }
  }

  /** The record only if the process it names is still alive; `null` covers
   *  both "never ran" and "left behind". */
  static async readLive(dataDir: string): Promise<RunState | null> {
    const state = await RunFile.read(dataDir);
    if (!state) return null;
    return RunFile.isLive(state) ? state : null;
  }

  static isLive(state: RunState, clock: LivenessClock = {}): boolean {
    return RunFile.liveness(state, clock).live;
  }

  /** The tests in the order they are cheapest and surest; see the class note. */
  static liveness(state: RunState, clock: LivenessClock = {}): RunLiveness {
    const pid = clock.pid ?? process.pid;
    if (state.pid === pid) {
      return { live: false, reason: `pid ${state.pid} is this process, so the record is a predecessor's` };
    }

    const bootId = clock.bootId ?? BootId.current();
    if (bootId && state.boot_id && state.boot_id !== bootId) {
      return { live: false, reason: "the record was written before the last reboot" };
    }

    if (!Daemon.isAlive(state.pid)) {
      return { live: false, reason: `pid ${state.pid} is gone` };
    }

    if (state.heartbeat_at !== undefined) {
      const last = Date.parse(state.heartbeat_at);
      const now = clock.now ?? Date.now();
      if (Number.isFinite(last) && now - last > RunFile.StaleAfterMs) {
        const minutes = Math.round((now - last) / 60_000);
        return {
          live: false,
          reason: `the record was last refreshed ${minutes} minute${minutes === 1 ? "" : "s"} ago, and a live server refreshes it every ${RunFile.HeartbeatMs / 1000}s`,
        };
      }
    }

    return { live: true };
  }

  static async remove(dataDir: string): Promise<void> {
    await fs.rm(RunFile.pathFor(dataDir), { force: true }).catch(() => {});
  }

  /**
   * Refuses to start a second server over a live one, and hands back the stale
   * record it is about to replace, if there was one, so the caller can say so.
   *
   * This is the guard the storage adapters cannot provide for themselves. Two
   * processes on one data directory are not merely racy: the fs adapter holds
   * `last_seq` in memory, so both hand out the same `seq` values, and `seq` is
   * the instance-global write cursor a change feed will depend on (§5.1).
   * `SiloService` also serialises writes on a process-local mutex, which is what
   * makes optimistic concurrency sound — a second process makes lost updates
   * possible again.
   */
  static async assertNotRunning(dataDir: string): Promise<RunState | null> {
    const state = await RunFile.read(dataDir);
    if (!state) return null;
    if (!RunFile.isLive(state)) return state;
    throw new Error(
      `silo is already running on ${dataDir} (pid ${state.pid}, listening on ${state.listen}). ` +
        `Stop it with "silo stop --data ${dataDir}", or start this one with a different --data directory.`
    );
  }
}
