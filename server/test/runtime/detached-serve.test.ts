import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Daemon } from "../../runtime/daemon";
import { RunFile } from "../../runtime/run-file";

/**
 * The detached start path, end to end, because its two failure modes only
 * exist across a process boundary and neither can be reached by calling the
 * classes directly.
 *
 * These spawn real servers on real ports, so they are deliberately few.
 */
describe("silo serve --detach", () => {
  const entry = path.join(import.meta.dir, "..", "..", "main.ts");
  let dirs: string[] = [];
  let started: number[] = [];

  const dataDir = async (): Promise<string> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-detach-test-"));
    dirs.push(dir);
    return dir;
  };

  // Ports well outside anything a developer is likely to be running, and
  // distinct per test so a lingering process cannot make the next one flaky.
  let nextPort = 8931;
  const port = () => nextPort++;

  const silo = async (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    const proc = Bun.spawn([process.execPath, entry, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  };

  const startDetached = async (dir: string, listen: string) => {
    const result = await silo(["serve", "--detach", "--data", dir, "--listen", listen]);
    const state = await RunFile.read(dir);
    if (state) started.push(state.pid);
    return result;
  };

  beforeEach(() => {
    dirs = [];
    started = [];
  });

  afterEach(async () => {
    for (const pid of started) {
      await Daemon.terminate(pid, 5_000).catch(() => {});
    }
    for (const dir of dirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("starts, records itself, serves, and stops", async () => {
    const dir = await dataDir();
    const listen = `:${port()}`;

    const start = await startDetached(dir, listen);
    expect(start.code).toBe(0);
    expect(start.stdout).toContain("started in the background");

    const state = await RunFile.read(dir);
    expect(state).toMatchObject({ listen, data: dir, driver: "sqlite" });
    expect(Daemon.isAlive(state!.pid)).toBe(true);
    // The derived log file, since nothing named one.
    expect(state!.log).toBe(path.join(dir, "silo.log"));

    const health = await fetch(`http://127.0.0.1${listen}/api/health`);
    expect(health.ok).toBe(true);

    // The root key reached the log rather than a terminal nobody was watching.
    expect(await fs.readFile(state!.log!, "utf8")).toContain("root API key");

    const status = await silo(["status", "--data", dir]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("silo is running");

    const stop = await silo(["stop", "--data", dir]);
    expect(stop.code).toBe(0);
    expect(stop.stdout).toContain(`stopped silo (pid ${state!.pid})`);
    expect(await RunFile.read(dir)).toBeNull();

    const after = await silo(["status", "--data", dir]);
    expect(after.code).toBe(1);
    expect(after.stdout).toContain("not running");
  }, 40_000);

  /**
   * The regression this exists for: the parent used to decide the child had
   * started by probing `/api/health`, which the *other* instance on that port
   * answered. A start that died on `EADDRINUSE` was reported as a success,
   * with a pid that no longer existed. Evidence has to be the child's own run
   * file, stamped with its own pid.
   */
  test("a start that loses the port fails, and says why", async () => {
    const listen = `:${port()}`;
    const held = await dataDir();
    expect((await startDetached(held, listen)).code).toBe(0);

    const loser = await dataDir();
    const result = await startDetached(loser, listen);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("did not come up");
    // The reason only exists in the child's log; the parent has to surface it.
    expect(result.stderr).toContain("port");
    expect(await RunFile.read(loser)).toBeNull();
  }, 40_000);

  test("refuses to start a second server over a live one", async () => {
    const dir = await dataDir();
    expect((await startDetached(dir, `:${port()}`)).code).toBe(0);

    const second = await silo(["serve", "--detach", "--data", dir, "--listen", `:${port()}`]);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("already running");
  }, 40_000);
});
