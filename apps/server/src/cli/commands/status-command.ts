import type { Config } from "../../config/config";
import { Daemon } from "../../runtime/daemon";
import { ListenAddress } from "../../runtime/listen-address";
import { RunFile } from "../../runtime/run-file";

/**
 * `silo status` — whether a server is running on this data directory, and what
 * it was started with.
 *
 * Exits non-zero when nothing is running, so a shell can branch on it. The two
 * questions it answers are deliberately separate: the operating system says
 * whether the process exists, and `/api/health` says whether it is serving. A
 * process that is alive but wedged is a different problem from a dead one, and
 * reporting them as the same thing would hide it.
 */
export class StatusCommand {
  static async run(config: Config): Promise<void> {
    const state = await RunFile.read(config.storage.path);

    if (!state) {
      console.log(`silo is not running (${config.storage.path})`);
      process.exit(1);
    }

    if (!Daemon.isAlive(state.pid)) {
      console.log(
        `silo is not running (${config.storage.path}) — pid ${state.pid} is gone, ` +
          `leaving a stale ${RunFile.Name}. "silo stop" clears it.`
      );
      process.exit(1);
    }

    const healthUrl = ListenAddress.healthUrl(state.listen);
    const serving = await StatusCommand.probe(healthUrl);

    console.log(serving ? "silo is running" : "silo is running but not serving");
    const rows: [string, string][] = [
      ["pid", String(state.pid)],
      ["version", state.version],
      ["listen", state.listen],
      ["health", serving ? `ok · ${healthUrl}` : `no response · ${healthUrl}`],
      ["driver", state.driver],
      ["data", state.data],
      ["log", state.log ?? "console (this server writes no log file)"],
      ["uptime", StatusCommand.uptime(state.started_at)],
    ];
    for (const [label, value] of rows) {
      console.log(`  ${label.padEnd(8)}${value}`);
    }

    if (!serving) process.exit(1);
  }

  private static async probe(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  private static uptime(startedAt: string): string {
    const started = Date.parse(startedAt);
    if (Number.isNaN(started)) return "unknown";
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}
