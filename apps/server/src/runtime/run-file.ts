import fs from "fs/promises";
import path from "path";
import { Daemon } from "./daemon";
import type { RunState } from "./run-state";

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
 * **Staleness** is decided by asking the operating system, not by trusting the
 * file: a SIGKILLed or power-cut server leaves the record behind, so a pid
 * that no longer exists means the file is debris and can be stolen. The
 * residual hazard is pid reuse — a recycled pid makes a dead server look
 * alive — which is the same trade every pid-file daemon makes, and is why
 * `stop` reports what it signalled rather than doing it silently.
 */
export class RunFile {
  static readonly Name = "silo.run.json";

  static pathFor(dataDir: string): string {
    return path.join(dataDir, RunFile.Name);
  }

  static async write(dataDir: string, state: RunState): Promise<void> {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(RunFile.pathFor(dataDir), JSON.stringify(state, null, 2) + "\n", "utf8");
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
    return Daemon.isAlive(state.pid) ? state : null;
  }

  static async remove(dataDir: string): Promise<void> {
    await fs.rm(RunFile.pathFor(dataDir), { force: true }).catch(() => {});
  }

  /**
   * Refuses to start a second server over a live one.
   *
   * This is the guard the storage adapters cannot provide for themselves. Two
   * processes on one data directory are not merely racy: the fs adapter holds
   * `last_seq` in memory, so both hand out the same `seq` values, and `seq` is
   * the instance-global write cursor a change feed will depend on (§5.1).
   * `SiloService` also serialises writes on a process-local mutex, which is what
   * makes optimistic concurrency sound — a second process makes lost updates
   * possible again.
   */
  static async assertNotRunning(dataDir: string): Promise<void> {
    const live = await RunFile.readLive(dataDir);
    if (!live) return;
    throw new Error(
      `silo is already running on ${dataDir} (pid ${live.pid}, listening on ${live.listen}). ` +
        `Stop it with "silo stop --data ${dataDir}", or start this one with a different --data directory.`
    );
  }
}
