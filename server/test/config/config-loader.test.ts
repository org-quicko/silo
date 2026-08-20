import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Cli } from "../../cli/cli";
import { ConfigLoader } from "../../config/config-loader";

/**
 * The layering is flag > env > file > default (§10), and the fs blob path is
 * the one setting that hangs off another: it follows the data dir unless
 * somebody names it. Getting that wrong splits one instance across two
 * locations — SQLite under `--data`, uploads under the built-in default — which
 * is silent until you go looking for the files.
 */
describe("ConfigLoader blob path resolution", () => {
  let tempDir: string;
  const savedBlobPath = process.env.SILO_BLOB_PATH;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-config-test-"));
    delete process.env.SILO_BLOB_PATH;
  });

  afterEach(async () => {
    if (savedBlobPath === undefined) delete process.env.SILO_BLOB_PATH;
    else process.env.SILO_BLOB_PATH = savedBlobPath;
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const writeConfig = async (toml: string): Promise<string> => {
    const file = path.join(tempDir, "silo.toml");
    await fs.writeFile(file, toml);
    return file;
  };

  test("the default fs path is left unset until it is derived", () => {
    // Absence is what tells "the user chose this" apart from "nobody said".
    expect(ConfigLoader.defaultConfig().blob_storage.path).toBeUndefined();
  });

  test("an untouched config puts media under the default data dir", async () => {
    const cfg = ConfigLoader.resolveDerivedDefaults(await ConfigLoader.loadConfig(path.join(tempDir, "absent.toml")));
    expect(cfg.storage.path).toBe("./silo_data");
    expect(cfg.blob_storage.path).toBe(path.join("./silo_data", "media"));
  });

  test("--data moves media along with the database", async () => {
    const dataDir = path.join(tempDir, "data");
    const loaded = await ConfigLoader.loadConfig(path.join(tempDir, "absent.toml"));
    const cfg = ConfigLoader.resolveDerivedDefaults(Cli.applyFlagOverrides(loaded, { data: dataDir }));
    expect(cfg.storage.path).toBe(dataDir);
    expect(cfg.blob_storage.path).toBe(path.join(dataDir, "media"));
  });

  test("--data leaves a path from the config file alone", async () => {
    const file = await writeConfig(`[blob_storage]\npath = "/srv/silo-media"\n`);
    const loaded = await ConfigLoader.loadConfig(file, true);
    const cfg = ConfigLoader.resolveDerivedDefaults(Cli.applyFlagOverrides(loaded, { data: path.join(tempDir, "data") }));
    expect(cfg.blob_storage.path).toBe("/srv/silo-media");
  });

  test("--data leaves SILO_BLOB_PATH alone", async () => {
    process.env.SILO_BLOB_PATH = "/srv/env-media";
    const loaded = await ConfigLoader.loadConfig(path.join(tempDir, "absent.toml"));
    const cfg = ConfigLoader.resolveDerivedDefaults(Cli.applyFlagOverrides(loaded, { data: path.join(tempDir, "data") }));
    expect(cfg.blob_storage.path).toBe("/srv/env-media");
  });

  test("--blob-path outranks the env var, the file, and --data", async () => {
    const file = await writeConfig(`[blob_storage]\npath = "/srv/file-media"\n`);
    process.env.SILO_BLOB_PATH = "/srv/env-media";
    const loaded = await ConfigLoader.loadConfig(file, true);
    const cfg = ConfigLoader.resolveDerivedDefaults(
      Cli.applyFlagOverrides(loaded, { data: path.join(tempDir, "data"), "blob-path": "/srv/flag-media" })
    );
    expect(cfg.blob_storage.path).toBe("/srv/flag-media");
  });

  test("the fs driver is recognised however it is spelled", async () => {
    // BlobStorageFactory lowercases the driver before it switches on it; if the
    // derivation is stricter than that, "FS" quietly lands in the fallback path.
    const file = await writeConfig(`[blob_storage]\ndriver = "FS"\n`);
    const dataDir = path.join(tempDir, "data");
    const loaded = await ConfigLoader.loadConfig(file, true);
    const cfg = ConfigLoader.resolveDerivedDefaults(Cli.applyFlagOverrides(loaded, { data: dataDir }));
    expect(cfg.blob_storage.path).toBe(path.join(dataDir, "media"));
  });

  test("a non-fs driver gets no path invented for it", async () => {
    const file = await writeConfig(`[blob_storage]\ndriver = "s3"\nbucket = "silo-media"\n`);
    const loaded = await ConfigLoader.loadConfig(file, true);
    const cfg = ConfigLoader.resolveDerivedDefaults(Cli.applyFlagOverrides(loaded, { data: path.join(tempDir, "data") }));
    expect(cfg.blob_storage.path).toBeUndefined();
    expect(cfg.blob_storage.bucket).toBe("silo-media");
  });
});
