import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

/**
 * A pending threaded read must keep the process alive (D81).
 *
 * The read thread is unref'd when idle so a finished CLI command can end. Left
 * unref'd while a read was out, the first threaded read of `silo keys list` or
 * `serve` was the only thing on the loop, the loop drained, and the process
 * exited 0 with nothing printed — a failure that only exists across a process
 * boundary, which is why both cases here spawn one. `bun test` sets
 * `NODE_ENV=test`, which turns the thread off, so the children get an
 * environment without it.
 */
describe("SQLite read thread keeps the process alive", () => {
  const entry = path.join(import.meta.dir, "..", "..", "src", "main.ts");
  const child = path.join(import.meta.dir, "support", "read-thread-child.ts");
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-read-thread-liveness-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const run = async (args: string[]) => {
    const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1" };
    delete env.NODE_ENV;
    delete env.SILO_READ_THREAD;
    const proc = Bun.spawn([process.execPath, ...args], { stdout: "pipe", stderr: "pipe", env });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  };

  test("a store's threaded read is answered before the loop is allowed to drain", async () => {
    const result = await run([child, path.join(tempDir, "test.db")]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("rows: 0");
    expect(result.stdout).toContain("closed");
  }, 30_000);

  test("silo keys list prints its table with the read thread on", async () => {
    const result = await run([entry, "keys", "list", "--data", tempDir]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("ID");
    expect(result.stdout).toContain("LABEL");
  }, 30_000);
});
