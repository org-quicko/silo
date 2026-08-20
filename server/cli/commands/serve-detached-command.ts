import fs from "fs";
import type { Config } from "../../config/config";
import { LogLocation } from "../../logging/log-location";
import { LogTail } from "../../logging/log-tail";
import { Daemon } from "../../runtime/daemon";
import { RunFile } from "../../runtime/run-file";
import type { RunState } from "../../runtime/run-state";

/**
 * `silo serve --detach` — the same server, started in the background.
 *
 * Runs *before* storage is opened, like `silo init` does and for the same
 * reason: this process is not the server, and it must not create or touch a
 * data directory that the child is about to take ownership of.
 *
 * The parent does not exit the moment the child is spawned. A detached start
 * that dies immediately — a bound port, an unreadable data directory — would
 * otherwise report success and leave the operator to discover it later, which
 * is the failure mode that makes people distrust background processes. So it
 * waits for evidence, and prints the end of the child's log when none arrives.
 */
export class ServeDetachedCommand {
  /** How long the bound server gets to answer a request once it has recorded
   *  itself. Short: the bind already succeeded, so this only catches a wedge. */
  private static readonly HealthTimeoutMs = 5_000;
  private static readonly PollMs = 100;

  static async run(cfg: Config, version: string): Promise<void> {
    await RunFile.assertNotRunning(cfg.storage.path);

    const firstRun = !fs.existsSync(cfg.storage.path);
    const logFile = LogLocation.forDetached(cfg);
    // Passed explicitly rather than derived again in the child: the child then
    // needs no notion of having been detached, the two cannot disagree, and
    // the path is visible in `ps`. Omitted when configuration already names
    // one, since the child reads the same configuration.
    const extraArgs = cfg.log.file ? [] : ["--log-file", logFile];

    const pid = Daemon.spawnDetached(logFile, extraArgs);

    const started = await ServeDetachedCommand.awaitRunFile(cfg.storage.path, pid, Daemon.StartTimeoutMs);
    if (!started) {
      ServeDetachedCommand.report(`the background server (pid ${pid}) did not come up on ${cfg.listen}`, logFile);
    }

    if (!(await Daemon.waitForHealth(started.listen, pid, ServeDetachedCommand.HealthTimeoutMs))) {
      ServeDetachedCommand.report(
        `the background server (pid ${pid}) bound ${started.listen} but is not answering /api/health`,
        logFile
      );
    }

    console.log(`silo ${version} started in the background`);
    console.log(`  pid     ${pid}`);
    console.log(`  listen  ${started.listen}`);
    console.log(`  data    ${cfg.storage.path}`);
    console.log(`  log     ${logFile}`);
    if (firstRun) {
      console.log(`\nFirst run: the root API key was printed into that log, once and only once.`);
    }
    console.log(`\nFollow it with "silo logs --follow", stop it with "silo stop".`);
  }

  /**
   * Waits for the child to record itself, which is the only unambiguous
   * evidence that *this* process bound the port.
   *
   * Probing `/api/health` cannot answer the question: a port already held by
   * another silo answers it happily, so a child that died on `EADDRINUSE`
   * would be reported as a successful start. The child writes its run file
   * only after `Bun.serve` returns, and stamps its own pid into it, so a
   * matching pid means this child — and nothing else — is up.
   */
  private static async awaitRunFile(dataDir: string, pid: number, timeoutMs: number): Promise<RunState | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await RunFile.read(dataDir);
      if (state && state.pid === pid) return state;
      // Checked after the read, so a child that recorded itself and then
      // exited is still reported on what it wrote rather than as a failure.
      if (!Daemon.isAlive(pid)) return null;
      await Bun.sleep(ServeDetachedCommand.PollMs);
    }
    return null;
  }

  /** Prints the failure with the end of the child's log — the only place the
   *  reason exists, since a detached child has no terminal to print to. */
  private static report(problem: string, logFile: string): never {
    console.error(`silo: ${problem}.`);
    const tail = LogTail.read(logFile, 20);
    if (tail.length > 0) {
      console.error(`\nlast lines of ${logFile}:`);
      for (const line of tail) console.error(`  ${line}`);
    } else {
      console.error(`nothing was written to ${logFile}.`);
    }
    process.exit(1);
  }
}
