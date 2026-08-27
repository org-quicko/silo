import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Daemon } from "../../src/runtime/daemon";
import { ListenAddress } from "../../src/runtime/listen-address";
import { RunFile } from "../../src/runtime/run-file";
import type { RunState } from "../../src/runtime/run-state";

/**
 * The run file is the only thing standing between a user and two servers on
 * one data directory, which is not a race but silent corruption: the fs
 * adapter holds `last_seq` in memory, so both processes hand out the same
 * `seq` values, and `SiloService` serialises writes on a mutex that is local to
 * one process. So the properties under test are that a live server is
 * detected, and — just as important — that a dead one is not, since a crashed
 * server must never lock its own data directory out of use.
 */
describe("RunFile", () => {
  let dir: string;

  const state = (over: Partial<RunState> = {}): RunState => ({
    pid: process.pid,
    version: "test",
    listen: ":8090",
    data: dir,
    driver: "sqlite",
    started_at: new Date().toISOString(),
    ...over,
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-run-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  /** A pid that has certainly exited: started, then reaped. */
  const deadPid = async (): Promise<number> => {
    const child = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
    const pid = child.pid;
    child.kill("SIGKILL");
    await child.exited;
    // A just-reaped pid can linger for an instant on some platforms.
    for (let i = 0; i < 50 && Daemon.isAlive(pid); i++) await Bun.sleep(20);
    return pid;
  };

  test("round-trips what a server recorded about itself", async () => {
    const written = state({ log: path.join(dir, "silo.log") });
    await RunFile.write(dir, written);
    expect(await RunFile.read(dir)).toEqual(written);
  });

  test("creates the data directory it writes into", async () => {
    const fresh = path.join(dir, "not-yet");
    await RunFile.write(fresh, state({ data: fresh }));
    expect(await RunFile.read(fresh)).toMatchObject({ data: fresh });
  });

  test("no file reads as nothing, not as an error", async () => {
    expect(await RunFile.read(dir)).toBeNull();
    expect(await RunFile.readLive(dir)).toBeNull();
  });

  /** A crash mid-write leaves a partial file. It means the same thing as no
   *  file — no usable record — and must not take a command down with it. */
  test("a truncated file reads as nothing", async () => {
    await fs.writeFile(RunFile.pathFor(dir), '{"pid": 12');
    expect(await RunFile.read(dir)).toBeNull();
    expect(await RunFile.readLive(dir)).toBeNull();
  });

  test("a live pid reads as live, and blocks a second server", async () => {
    await RunFile.write(dir, state());
    expect(await RunFile.readLive(dir)).toMatchObject({ pid: process.pid });
    await expect(RunFile.assertNotRunning(dir)).rejects.toThrow(/already running/);
  });

  test("a dead pid is stale: readable, not live, and no longer blocking", async () => {
    const pid = await deadPid();
    await RunFile.write(dir, state({ pid }));

    expect(await RunFile.read(dir)).toMatchObject({ pid });
    expect(await RunFile.readLive(dir)).toBeNull();
    // The whole point: a server that was killed must not lock its data
    // directory out of use forever.
    await RunFile.assertNotRunning(dir);
  });

  test("the refusal names the port and the way out", async () => {
    await RunFile.write(dir, state({ listen: "127.0.0.1:9123" }));
    await expect(RunFile.assertNotRunning(dir)).rejects.toThrow(/127\.0\.0\.1:9123/);
    await expect(RunFile.assertNotRunning(dir)).rejects.toThrow(/silo stop/);
  });

  test("remove is idempotent", async () => {
    await RunFile.write(dir, state());
    await RunFile.remove(dir);
    await RunFile.remove(dir);
    expect(await RunFile.read(dir)).toBeNull();
  });

  test("a nonsense pid is never alive", () => {
    expect(Daemon.isAlive(0)).toBe(false);
    expect(Daemon.isAlive(-1)).toBe(false);
    expect(Daemon.isAlive(process.pid)).toBe(true);
  });
});

describe("ListenAddress", () => {
  test("parses the forms the listen setting accepts", () => {
    expect(ListenAddress.parse(":8090")).toEqual({ hostname: undefined, port: 8090 });
    expect(ListenAddress.parse("127.0.0.1:9000")).toEqual({ hostname: "127.0.0.1", port: 9000 });
    expect(ListenAddress.parse("8090")).toEqual({ hostname: undefined, port: 8090 });
  });

  /** Falling back beats binding port 0, which succeeds and then listens
   *  somewhere nothing can find again. */
  test("an unparseable port falls back to the default", () => {
    expect(ListenAddress.parse(":not-a-port").port).toBe(ListenAddress.DefaultPort);
  });

  test("a wildcard bind is probed on loopback", () => {
    expect(ListenAddress.healthUrl(":8090")).toBe("http://127.0.0.1:8090/api/health");
    expect(ListenAddress.healthUrl("0.0.0.0:9000")).toBe("http://127.0.0.1:9000/api/health");
    expect(ListenAddress.healthUrl("10.0.0.4:9000")).toBe("http://10.0.0.4:9000/api/health");
  });
});
