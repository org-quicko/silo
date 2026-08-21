import { describe, test, expect, afterAll } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Daemon } from "../../runtime/daemon";
import { RunFile } from "../../runtime/run-file";

/**
 * `serve --detach` from a compiled binary, which is a different program from
 * `serve --detach` under `bun run` and used to be a broken one.
 *
 * A compiled binary's argv[1] is a path inside Bun's virtual filesystem, and
 * the daemon forwards argv[1] to the child because from source it is the entry
 * script. Deciding between the two with `fs.existsSync` looked sound and was
 * not: inside the binary Bun answers `true` for the virtual path, so it was
 * forwarded, and the child — which reads `argv.slice(2)` — took it for a
 * subcommand and died on `unknown command "B:/~BUN/root/silo"`. Every detached
 * start of a released binary failed while every test passed.
 *
 * Nothing short of a real binary reaches that: from source the virtual path is
 * absent from the filesystem, so the broken check and the correct one agree.
 * Hence the cost here — one `bun build --compile`, about a second and a large
 * temporary file — and hence only one test.
 */
describe("silo serve --detach, compiled", () => {
  const entry = path.join(import.meta.dir, "..", "..", "main.ts");
  const dirs: string[] = [];
  const started: number[] = [];

  const tempDir = async (prefix: string): Promise<string> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };

  const run = async (command: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    const proc = Bun.spawn(command, {
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

  afterAll(async () => {
    for (const pid of started) await Daemon.terminate(pid, 5_000).catch(() => {});
    for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  test("the child runs the server, not the virtual entry path", async () => {
    const buildDir = await tempDir("silo-compile-test-");
    // Bun appends `.exe` on Windows, so ask for the artifact rather than assume.
    const requested = path.join(buildDir, "silo");
    const built = await run([process.execPath, "build", entry, "--compile", "--outfile", requested]);
    expect(built.code).toBe(0);
    const binary = process.platform === "win32" ? `${requested}.exe` : requested;

    const dir = await tempDir("silo-compiled-detach-");
    const listen = ":8951";
    const start = await run([binary, "serve", "--detach", "--data", dir, "--listen", listen]);

    expect(start.code).toBe(0);
    expect(start.stdout).toContain("started in the background");

    const state = await RunFile.read(dir);
    if (state) started.push(state.pid);
    expect(state).toMatchObject({ listen, driver: "sqlite" });
    expect(Daemon.isAlive(state!.pid)).toBe(true);

    // The failure mode was a child that printed usage and exited, so assert on
    // its own output too: a run file alone could in principle outlive it.
    const log = await fs.readFile(state!.log!, "utf8");
    expect(log).not.toContain("unknown command");
    expect(log).toContain("listening");

    const stop = await run([binary, "stop", "--data", dir]);
    expect(stop.code).toBe(0);
    expect(await RunFile.read(dir)).toBeNull();
  }, 120_000);
});
