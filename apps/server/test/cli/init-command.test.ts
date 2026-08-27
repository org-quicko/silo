import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { InitCommand } from "../../src/cli/commands/init-command";
import { ConfigLoader } from "../../src/config/config-loader";

/**
 * `silo init` scaffolds the file every other layer sits on top of, so the one
 * property that matters is that the scaffold and the built-in defaults are the
 * same thing: a freshly written config must change nothing.
 */
describe("silo init", () => {
  let tempDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-init-test-"));
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
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const init = async (name = "silo.toml", force = false): Promise<string> => {
    const file = path.join(tempDir, name);
    await InitCommand.run(file, force);
    return file;
  };

  test("the written file loads back as exactly the defaults", async () => {
    const file = await init();
    // Explicit, so a file the loader cannot parse fails here instead of being
    // silently swallowed into the defaults it is being compared against.
    expect(await ConfigLoader.loadConfig(file, true)).toEqual(ConfigLoader.defaultConfig());
  });

  test("the log file stays commented, so a container still logs to its stream", async () => {
    const config = await ConfigLoader.loadConfig(await init(), true);
    expect(config.log.file).toBeUndefined();
  });

  test("the fs media path stays commented, so --data still moves media", async () => {
    const file = await init();
    const config = await ConfigLoader.loadConfig(file, true);
    expect(config.blob_storage.path).toBeUndefined();
    expect(ConfigLoader.resolveDerivedDefaults(config).blob_storage.path).toBe(path.join("./silo_data", "media"));
  });

  test("every key silo reads is named in the file, set or commented", async () => {
    const body = await fs.readFile(await init(), "utf8");
    for (const key of [
      "listen",
      "default_project",
      "default_env",
      "[storage]",
      "driver",
      "path",
      "[blob_storage]",
      "bucket",
      "region",
      "endpoint",
      "access_key_id",
      "secret_access_key",
      "force_path_style",
      "[auth]",
      "disabled",
      "[schema]",
      "allow_remote_refs",
      "[log]",
      "level",
      "format",
      "requests",
      "max_size_mb",
      "max_files",
      "file",
    ]) {
      expect(body).toContain(key);
    }
  });

  test("an existing file is refused, and overwritten only with --force", async () => {
    const file = await init();
    await fs.writeFile(file, "listen = \":9999\"\n");

    await expect(InitCommand.run(file, false)).rejects.toThrow(/already exists/);
    expect(await ConfigLoader.loadConfig(file, true)).toMatchObject({ listen: ":9999" });

    await InitCommand.run(file, true);
    expect(await ConfigLoader.loadConfig(file, true)).toEqual(ConfigLoader.defaultConfig());
  });

  test("a missing parent directory is created", async () => {
    const file = await init(path.join("nested", "conf", "silo.toml"));
    expect(await ConfigLoader.loadConfig(file, true)).toEqual(ConfigLoader.defaultConfig());
  });
});
