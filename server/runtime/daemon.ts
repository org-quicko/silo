import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { ListenAddress } from "./listen-address";

/**
 * Starting, waiting on, and stopping a silo that runs without a terminal.
 *
 * Process mechanics only — the CLI commands own what gets printed. Detaching
 * is for bare metal and for development; under Docker, systemd or any other
 * supervisor, run `silo serve` in the foreground and let the supervisor own
 * the process, its restarts and its stream.
 */
export class Daemon {
  /** How long a started server gets to answer `/api/health` before the parent
   *  reports it as failed. Generous: first boot creates the data directory,
   *  runs DDL and may generate a root key. */
  static readonly StartTimeoutMs = 15_000;
  /** How long a stopped server gets to finish in-flight writes after SIGTERM
   *  before it is killed. */
  static readonly StopTimeoutMs = 10_000;

  /**
   * Re-runs this same command in a child that outlives the parent.
   *
   * The child's stdout and stderr go to the log file, not to `/dev/null`. The
   * `Logger` already writes its own lines there, so this is not the normal
   * path for them — it is the net for everything that never reaches a logger:
   * an uncaught exception's stack, a Bun panic, a native crash. Losing those
   * is exactly how a detached process becomes impossible to debug.
   */
  static spawnDetached(logFile: string, extraArgs: string[]): number {
    const dir = path.dirname(logFile);
    if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(logFile, "a");
    try {
      const child = spawn(process.execPath, [...Daemon.relaunchArgs(), ...extraArgs], {
        detached: true,
        stdio: ["ignore", fd, fd],
        cwd: process.cwd(),
        env: process.env,
      });
      child.unref();
      if (typeof child.pid !== "number") {
        throw new Error("could not start the background process");
      }
      return child.pid;
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * The argument list that re-runs silo, minus `--detach`.
   *
   * Two shapes to cover: `bun run server/main.ts serve …`, where argv[1] is
   * the entry script and has to be passed on, and a compiled `silo` binary,
   * where argv[1] is a path inside Bun's virtual filesystem — `/$bunfs/root/silo`,
   * or `B:/~BUN/root/silo` on Windows. That one must never be forwarded: the
   * child gets its own, so a second copy arrives as argv[2] and the CLI, which
   * reads `argv.slice(2)`, takes it for a subcommand and exits on
   * `unknown command "B:/~BUN/root/silo"`.
   *
   * `realpathSync` is what separates the two. `existsSync` cannot, which is the
   * bug this replaced: inside a compiled binary it answers **true** for the
   * virtual path, as does `statSync`, because Bun serves both from the embedded
   * filesystem. Only resolving the path against the real one fails there
   * (`ENOENT`), so the check stays independent of how Bun spells its virtual
   * root — while no longer trusting it to be absent from the filesystem API.
   *
   * Parameterized because the compiled shape is otherwise only reachable by
   * building a binary: the defaults are the real process, and the tests pass
   * both argv shapes in directly.
   */
  static relaunchArgs(argv: string[] = process.argv, execPath: string = process.execPath): string[] {
    const args: string[] = [];
    const script = argv[1];
    if (script && script !== execPath && Daemon.isRealFile(script)) {
      args.push(script);
    }
    for (const arg of argv.slice(2)) {
      if (arg === "--detach" || arg === "-d") continue;
      args.push(arg);
    }
    return args;
  }

  /** True only for a path the operating system can resolve to a file of its
   *  own — see `relaunchArgs` for why the weaker checks do not do. */
  private static isRealFile(candidate: string): boolean {
    try {
      return fs.statSync(fs.realpathSync(candidate)).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Polls `/api/health` until the server answers or the deadline passes.
   *
   * Note what this does **not** prove: that the server answering is the one
   * just started. A port already held by another instance answers perfectly
   * well, so this is a confirmation that something is serving, never the test
   * for whether a child came up — see `ServeDetachedCommand.awaitRunFile`.
   */
  static async waitForHealth(listen: string, pid: number, timeoutMs: number): Promise<boolean> {
    const url = ListenAddress.healthUrl(listen);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (response.ok) return true;
      } catch {
        // Not up yet.
      }
      if (!Daemon.isAlive(pid)) return false;
      await Bun.sleep(150);
    }
    return false;
  }

  /**
   * SIGTERM, then SIGKILL if it has not gone by the deadline.
   *
   * SIGTERM first because `serve` installs a handler that closes storage; a
   * kill would skip it and, on the fs adapter, leave `manifest.json` behind
   * the entries it counts.
   */
  static async terminate(pid: number, timeoutMs: number): Promise<"stopped" | "killed"> {
    try {
      process.kill(pid, "SIGTERM");
    } catch (err: any) {
      if (err?.code === "ESRCH") return "stopped";
      throw err;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!Daemon.isAlive(pid)) return "stopped";
      await Bun.sleep(100);
    }

    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Went away between the last check and here.
    }
    for (let i = 0; i < 20 && Daemon.isAlive(pid); i++) await Bun.sleep(100);
    return "killed";
  }

  /** Signal 0 checks for the process without touching it. `EPERM` means it
   *  exists but belongs to another user — alive, and not ours to signal. */
  static isAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      return err?.code === "EPERM";
    }
  }
}
