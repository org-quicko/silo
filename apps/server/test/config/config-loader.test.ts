import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { CliOptions } from "../../src/cli/cli-options";
import { HttpDefaults } from "../../src/config/http-defaults";
import { TransferDefaults } from "../../src/config/transfer-defaults";
import { ConfigLoader } from "../../src/config/config-loader";

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
    await fs.rm(tempDir, { recursive: true, force: true });
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
    const config = ConfigLoader.resolveDerivedDefaults(await ConfigLoader.loadConfig(path.join(tempDir, "absent.toml")));
    expect(config.storage.path).toBe("./silo_data");
    expect(config.blob_storage.path).toBe(path.join("./silo_data", "media"));
  });

  test("--data moves media along with the database", async () => {
    const dataDir = path.join(tempDir, "data");
    const loaded = await ConfigLoader.loadConfig(path.join(tempDir, "absent.toml"));
    const config = ConfigLoader.resolveDerivedDefaults(CliOptions.applyOverrides(loaded, { data: dataDir }));
    expect(config.storage.path).toBe(dataDir);
    expect(config.blob_storage.path).toBe(path.join(dataDir, "media"));
  });

  test("--data leaves a path from the config file alone", async () => {
    const file = await writeConfig(`[blob_storage]\npath = "/srv/silo-media"\n`);
    const loaded = await ConfigLoader.loadConfig(file, true);
    const config = ConfigLoader.resolveDerivedDefaults(CliOptions.applyOverrides(loaded, { data: path.join(tempDir, "data") }));
    expect(config.blob_storage.path).toBe("/srv/silo-media");
  });

  test("--data leaves SILO_BLOB_PATH alone", async () => {
    process.env.SILO_BLOB_PATH = "/srv/env-media";
    const loaded = await ConfigLoader.loadConfig(path.join(tempDir, "absent.toml"));
    const config = ConfigLoader.resolveDerivedDefaults(CliOptions.applyOverrides(loaded, { data: path.join(tempDir, "data") }));
    expect(config.blob_storage.path).toBe("/srv/env-media");
  });

  test("--blob-path outranks the env var, the file, and --data", async () => {
    const file = await writeConfig(`[blob_storage]\npath = "/srv/file-media"\n`);
    process.env.SILO_BLOB_PATH = "/srv/env-media";
    const loaded = await ConfigLoader.loadConfig(file, true);
    const config = ConfigLoader.resolveDerivedDefaults(
      CliOptions.applyOverrides(loaded, { data: path.join(tempDir, "data"), "blob-path": "/srv/flag-media" })
    );
    expect(config.blob_storage.path).toBe("/srv/flag-media");
  });

  test("the fs driver is recognised however it is spelled", async () => {
    // ProviderRegistry lowercases the driver before it looks it up; if the
    // derivation is stricter than that, "FS" quietly lands in the fallback path.
    const file = await writeConfig(`[blob_storage]\ndriver = "FS"\n`);
    const dataDir = path.join(tempDir, "data");
    const loaded = await ConfigLoader.loadConfig(file, true);
    const config = ConfigLoader.resolveDerivedDefaults(CliOptions.applyOverrides(loaded, { data: dataDir }));
    expect(config.blob_storage.path).toBe(path.join(dataDir, "media"));
  });

  test("a non-fs driver gets no path invented for it", async () => {
    const file = await writeConfig(`[blob_storage]\ndriver = "s3"\nbucket = "silo-media"\n`);
    const loaded = await ConfigLoader.loadConfig(file, true);
    const config = ConfigLoader.resolveDerivedDefaults(CliOptions.applyOverrides(loaded, { data: path.join(tempDir, "data") }));
    expect(config.blob_storage.path).toBeUndefined();
    expect(config.blob_storage.bucket).toBe("silo-media");
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
    await fs.rm(tempDir, { recursive: true, force: true });
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

    const config = await ConfigLoader.loadConfig(file, true);
    expect(config.log).toMatchObject({ level: "warn", file: "/from/env.log", requests: false });
  });

  test("--log-file and --log-level outrank the env var and the file", async () => {
    const file = await writeConfig(`[log]\nlevel = "debug"\nfile = "/from/file.log"\n`);
    process.env.SILO_LOG_FILE = "/from/env.log";

    const config = CliOptions.applyOverrides(await ConfigLoader.loadConfig(file, true), {
      "log-file": "/from/flag.log",
      "log-level": "error",
    });
    expect(config.log).toMatchObject({ file: "/from/flag.log", level: "error" });
  });

  /** A malformed number must not turn rotation off or make the cap zero, which
   *  would rotate on every single line. */
  test("an unparseable numeric env var leaves the default in place", async () => {
    process.env.SILO_LOG_MAX_SIZE_MB = "lots";
    const config = await ConfigLoader.loadConfig(path.join(tempDir, "absent.toml"), false);
    expect(config.log.max_size_mb).toBe(ConfigLoader.defaultConfig().log.max_size_mb);
  });
});

/**
 * The listener's idle timeout (§10.3). It exists because the runtime's own
 * default is 10 seconds and a transfer route can legitimately say nothing for
 * longer, and the socket closing mid-response reaches the caller as a proxy
 * error naming the proxy rather than silo.
 */
describe("ConfigLoader http settings", () => {
  let tempDir: string;
  let saved: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-http-config-test-"));
    saved = process.env.SILO_HTTP_IDLE_TIMEOUT;
    delete process.env.SILO_HTTP_IDLE_TIMEOUT;
  });

  afterEach(async () => {
    if (saved === undefined) delete process.env.SILO_HTTP_IDLE_TIMEOUT;
    else process.env.SILO_HTTP_IDLE_TIMEOUT = saved;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const writeConfig = async (toml: string): Promise<string> => {
    const file = path.join(tempDir, "silo.toml");
    await fs.writeFile(file, toml);
    return file;
  };

  test("the default is far above the runtime's own", () => {
    expect(ConfigLoader.defaultConfig().http.idle_timeout).toBe(HttpDefaults.IdleTimeout);
    expect(HttpDefaults.IdleTimeout).toBeGreaterThan(10);
  });

  test("the file supplies it and the env var outranks the file", async () => {
    const file = await writeConfig(`[http]\nidle_timeout = 90\n`);
    expect((await ConfigLoader.loadConfig(file)).http.idle_timeout).toBe(90);

    process.env.SILO_HTTP_IDLE_TIMEOUT = "45";
    expect((await ConfigLoader.loadConfig(file)).http.idle_timeout).toBe(45);
  });

  test("a value above the runtime's ceiling is clamped, not refused", async () => {
    // Failing to start over a config that is merely too generous would turn a
    // cautious setting into an outage.
    const file = await writeConfig(`[http]\nidle_timeout = 6000\n`);
    expect((await ConfigLoader.loadConfig(file)).http.idle_timeout).toBe(HttpDefaults.MaxIdleTimeout);
  });

  test("zero is kept, because it is how the guard is switched off", async () => {
    const file = await writeConfig(`[http]\nidle_timeout = 0\n`);
    expect((await ConfigLoader.loadConfig(file)).http.idle_timeout).toBe(0);
  });

  test("an unparseable env var leaves the default in place", async () => {
    process.env.SILO_HTTP_IDLE_TIMEOUT = "soon";
    const config = await ConfigLoader.loadConfig(path.join(tempDir, "absent.toml"));
    expect(config.http.idle_timeout).toBe(HttpDefaults.IdleTimeout);
  });
});

/**
 * `[http] max_body_size_mb` and `max_json_body_size_mb` (§10.4): the ceiling
 * the runtime buffers up to per connection, and the smaller one every JSON
 * route gets. A value that names no bound at all falls back rather than
 * switching the guard off, because there is no "unlimited" that is safe.
 */
describe("ConfigLoader [http] body ceilings", () => {
  let tempDir: string;
  const names = ["SILO_HTTP_MAX_BODY_SIZE_MB", "SILO_HTTP_MAX_JSON_BODY_SIZE_MB"] as const;
  const saved: Partial<Record<(typeof names)[number], string | undefined>> = {};

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-http-body-config-test-"));
    for (const name of names) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(async () => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const writeConfig = async (toml: string): Promise<string> => {
    const file = path.join(tempDir, "silo.toml");
    await fs.writeFile(file, toml);
    return file;
  };

  test("the defaults are the runtime's own ceiling and a small JSON ceiling", () => {
    const http = ConfigLoader.defaultConfig().http;
    expect(http.max_body_size_mb).toBe(HttpDefaults.MaxBodySizeMb);
    expect(http.max_json_body_size_mb).toBe(HttpDefaults.MaxJsonBodySizeMb);
    expect(http.max_json_body_size_mb).toBeLessThan(http.max_body_size_mb);
  });

  test("the file supplies both and the env var outranks the file", async () => {
    const file = await writeConfig(`[http]\nmax_body_size_mb = 32\nmax_json_body_size_mb = 0.5\n`);
    let http = (await ConfigLoader.loadConfig(file)).http;
    expect(http.max_body_size_mb).toBe(32);
    expect(http.max_json_body_size_mb).toBe(0.5);

    process.env.SILO_HTTP_MAX_BODY_SIZE_MB = "16";
    process.env.SILO_HTTP_MAX_JSON_BODY_SIZE_MB = "1";
    http = (await ConfigLoader.loadConfig(file)).http;
    expect(http.max_body_size_mb).toBe(16);
    expect(http.max_json_body_size_mb).toBe(1);
  });

  test("zero, a negative number and an unparseable env var leave the default in place", async () => {
    const file = await writeConfig(`[http]\nmax_body_size_mb = 0\nmax_json_body_size_mb = -3\n`);
    process.env.SILO_HTTP_MAX_BODY_SIZE_MB = "plenty";
    const http = (await ConfigLoader.loadConfig(file)).http;
    expect(http.max_body_size_mb).toBe(HttpDefaults.MaxBodySizeMb);
    expect(http.max_json_body_size_mb).toBe(HttpDefaults.MaxJsonBodySizeMb);
  });

  test("bytes round up, so a fractional megabyte never rounds to no bound", () => {
    expect(HttpDefaults.bytes(1)).toBe(1024 * 1024);
    expect(HttpDefaults.bytes(1 / 1024)).toBe(1024);
    expect(HttpDefaults.bytes(0.0000001)).toBeGreaterThan(0);
  });
});

/**
 * `[transfer] max_archive_size_mb` and `max_extracted_size_mb` (§10.5): what a
 * streamed archive may weigh and what it may expand to. The same shape as the
 * body ceilings above, for the same reason — there is no safe "unlimited".
 */
describe("ConfigLoader [transfer] ceilings", () => {
  let tempDir: string;
  const names = ["SILO_TRANSFER_MAX_ARCHIVE_SIZE_MB", "SILO_TRANSFER_MAX_EXTRACTED_SIZE_MB"] as const;
  const saved: Partial<Record<(typeof names)[number], string | undefined>> = {};

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-transfer-config-test-"));
    for (const name of names) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(async () => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const writeConfig = async (toml: string): Promise<string> => {
    const file = path.join(tempDir, "silo.toml");
    await fs.writeFile(file, toml);
    return file;
  };

  test("the defaults hold an archive well under what it may expand to", () => {
    const transfer = ConfigLoader.defaultConfig().transfer;
    expect(transfer.max_archive_size_mb).toBe(TransferDefaults.MaxArchiveSizeMb);
    expect(transfer.max_extracted_size_mb).toBe(TransferDefaults.MaxExtractedSizeMb);
    expect(transfer.max_archive_size_mb).toBeLessThan(transfer.max_extracted_size_mb);
  });

  test("the file supplies both and the env var outranks the file", async () => {
    const file = await writeConfig(`[transfer]\nmax_archive_size_mb = 256\nmax_extracted_size_mb = 512\n`);
    let transfer = (await ConfigLoader.loadConfig(file)).transfer;
    expect(transfer).toEqual({ max_archive_size_mb: 256, max_extracted_size_mb: 512 });

    process.env.SILO_TRANSFER_MAX_ARCHIVE_SIZE_MB = "64";
    process.env.SILO_TRANSFER_MAX_EXTRACTED_SIZE_MB = "128";
    transfer = (await ConfigLoader.loadConfig(file)).transfer;
    expect(transfer).toEqual({ max_archive_size_mb: 64, max_extracted_size_mb: 128 });
  });

  test("zero, a negative number and an unparseable env var leave the default in place", async () => {
    const file = await writeConfig(`[transfer]\nmax_archive_size_mb = 0\nmax_extracted_size_mb = -3\n`);
    process.env.SILO_TRANSFER_MAX_ARCHIVE_SIZE_MB = "plenty";
    const transfer = (await ConfigLoader.loadConfig(file)).transfer;
    expect(transfer.max_archive_size_mb).toBe(TransferDefaults.MaxArchiveSizeMb);
    expect(transfer.max_extracted_size_mb).toBe(TransferDefaults.MaxExtractedSizeMb);
  });
});
