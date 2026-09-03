import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { ConfigLoader } from "../../src/config/config-loader";
import { ConfigScaffold } from "../../src/config/config-scaffold";

/**
 * `create` is the half written **unasked** — by an install that has a plugin to
 * list and no file to list it in (§13.21) — so the two properties that make that
 * defensible are the ones pinned here: the file it writes is silo's own defaults,
 * and a file that already exists is never touched.
 *
 * `silo init`'s own guarantees are in `test/cli/init-command.test.ts`.
 */
describe("ConfigScaffold.create", () => {
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-scaffold-test-"));
    // The loader reads env on top of the file; a SILO_* var in the ambient
    // environment would otherwise look like the file said it.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SILO_")) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    }
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("writes the defaults, and says it did", async () => {
    const configPath = path.join(dir, "nested", "silo.toml");

    expect(await ConfigScaffold.create(configPath)).toBe(true);
    expect(await ConfigLoader.loadConfig(configPath, true)).toEqual(ConfigLoader.defaultConfig());
  });

  test("leaves a file that is already there alone, and says it did not write", async () => {
    const configPath = path.join(dir, "silo.toml");
    await fs.writeFile(configPath, `listen = ":9999"\n`, "utf8");

    expect(await ConfigScaffold.create(configPath)).toBe(false);
    expect(await fs.readFile(configPath, "utf8")).toBe(`listen = ":9999"\n`);
  });
});
