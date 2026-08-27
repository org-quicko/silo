import type { Config } from "../../config/config";
import { Daemon } from "../../runtime/daemon";
import { RunFile } from "../../runtime/run-file";

/**
 * `silo stop` — signals the server recorded in the data directory.
 *
 * Stopping something already stopped is a success, not an error: the caller
 * asked for a state, and the state holds. Only a server that refuses to go
 * down is worth a non-zero exit.
 */
export class StopCommand {
  static async run(config: Config, timeoutMs: number): Promise<void> {
    const state = await RunFile.read(config.storage.path);
    if (!state) {
      console.log(`silo is not running (no ${RunFile.pathFor(config.storage.path)})`);
      return;
    }

    if (!Daemon.isAlive(state.pid)) {
      await RunFile.remove(config.storage.path);
      console.log(`silo is not running (cleared a stale record left by pid ${state.pid})`);
      return;
    }

    const outcome = await Daemon.terminate(state.pid, timeoutMs);
    // Removed whatever the outcome: a server that answered SIGTERM has already
    // deleted this itself, and one that had to be killed never got the chance.
    await RunFile.remove(config.storage.path);

    if (outcome === "killed") {
      console.error(
        `silo: pid ${state.pid} ignored SIGTERM for ${Math.round(timeoutMs / 1000)}s and was killed. ` +
          `In-flight writes may not have been flushed.`
      );
      process.exit(1);
    }
    console.log(`stopped silo (pid ${state.pid})`);
  }
}
