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

/**
 * The log destination follows the same layering, and the same "absence means
 * nobody said" rule as the blob path: unset is what lets a container keep
 * logging to its stream while a detached run derives a file.
 */
describe("ConfigLoader log settings", () => {
  let tempDir: string;
  const logVars = [
    "SILO_LOG_LEVEL",
    "SILO_LOG_FILE",
    "SILO_LOG_FORMAT",
    "SILO_LOG_REQUESTS",
    "SILO_LOG_MAX_SIZE_MB",
    "SILO_LOG_MAX_FILES",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-log-config-test-"));
    for (const key of logVars) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const key of logVars) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const writeConfig = async (toml: string): Promise<string> => {
    const file = path.join(tempDir, "silo.toml");
    await fs.writeFile(file, toml);
    return file;
  };

  test("the default log file is left unset, so the console is the destination", () => {
    const log = ConfigLoader.defaultConfig().log;
    expect(log.file).toBeUndefined();
    expect(log).toMatchObject({ level: "info", format: "text", requests: true });
  });

  test("the file supplies the whole section", async () => {
    const file = await writeConfig(
      `[log]\nlevel = "debug"\nfile = "/var/log/silo.log"\nformat = "json"\nrequests = false\nmax_size_mb = 25\nmax_files = 2\n`
    );
    expect((await ConfigLoader.loadConfig(file, true)).log).toEqual({
      level: "debug",
      file: "/var/log/silo.log",
      format: "json",
      requests: false,
      max_size_mb: 25,
      max_files: 2,
    });
  });

  test("env overrides the file", async () => {
    const file = await writeConfig(`[log]\nlevel = "debug"\nfile = "/from/file.log"\n`);
    process.env.SILO_LOG_LEVEL = "warn";
    process.env.SILO_LOG_FILE = "/from/env.log";
    process.env.SILO_LOG_REQUESTS = "false";

    const cfg = await ConfigLoader.loadConfig(file, true);
    expect(cfg.log).toMatchObject({ level: "warn", file: "/from/env.log", requests: false });
  });

  test("--log-file and --log-level outrank the env var and the file", async () => {
    const file = await writeConfig(`[log]\nlevel = "debug"\nfile = "/from/file.log"\n`);
    process.env.SILO_LOG_FILE = "/from/env.log";

    const cfg = Cli.applyFlagOverrides(await ConfigLoader.loadConfig(file, true), {
      "log-file": "/from/flag.log",
      "log-level": "error",
    });
    expect(cfg.log).toMatchObject({ file: "/from/flag.log", level: "error" });
  });

  /** A malformed number must not turn rotation off or make the cap zero, which
   *  would rotate on every single line. */
  test("an unparseable numeric env var leaves the default in place", async () => {
    process.env.SILO_LOG_MAX_SIZE_MB = "lots";
    const cfg = await ConfigLoader.loadConfig(path.join(tempDir, "absent.toml"), false);
    expect(cfg.log.max_size_mb).toBe(ConfigLoader.defaultConfig().log.max_size_mb);
  });
});
