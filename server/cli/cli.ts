import path from "path";
import { parseArgs } from "util";
import { BlobStorageFactory } from "../adapters/blob/blob-storage-factory";
import { FsStore } from "../adapters/storage/fs/fs-store";
import { SqliteStore } from "../adapters/storage/sqlite/sqlite-store";
import type { Config } from "../config/config";
import { ConfigLoader } from "../config/config-loader";
import { Service } from "../core/service/service";
import { ExportCommand } from "./commands/export-command";
import { ImportCommand } from "./commands/import-command";
import { InitCommand } from "./commands/init-command";
import { LogsCommand } from "./commands/logs-command";
import { MediaCommand } from "./commands/media-command";
import { KeysCommand } from "./commands/keys-command";
import { ServeCommand } from "./commands/serve-command";
import { ServeDetachedCommand } from "./commands/serve-detached-command";
import { StatusCommand } from "./commands/status-command";
import { StopCommand } from "./commands/stop-command";
import { Logger } from "../logging/logger";
import { Daemon } from "../runtime/daemon";

/** Argv parsing, subcommand routing, and dependency wiring for the silo CLI. */
export class Cli {
  private static readonly version = "0.1.0-dev";

  private static printUsage() {
    console.log(`silo, minimal portable headless CMS

Usage:
  silo init [flags]                      write a silo.toml of default settings
  silo serve [flags]                     start the server
  silo stop [flags]                      stop a server started with --detach
  silo status [flags]                    report whether a server is running
  silo logs [flags]                      show the server log
  silo keys create [flags]               mint an API key
  silo keys list [flags]                 list keys
  silo keys revoke [flags] <id>          revoke a key
  silo export [flags]                    export schemas and entries
  silo import [flags] <dir|tarball>      import schemas and entries
  silo media reconcile [flags]           repair the media catalog against stored blobs
  silo version
  silo help

Common flags:
  --config path     TOML config file (default: silo.toml if present)
  --data dir        data directory (default ./silo_data)
  --driver name     storage driver: sqlite | fs (default sqlite)
  --blob-path dir   media directory for the fs blob driver (default <data>/media)

init:
  --config path   file to write (default silo.toml)
  --force         overwrite an existing file

serve:
  --listen addr    listen address (default :8090)
  --project id     default project created on startup (default "default")
  --env id         default environment created on startup (default "prod")
  -d, --detach     run in the background and return; logs go to a file
  --log-file path  write the log here (detached runs default to <data>/silo.log)
  --log-level s    debug | info | warn | error | silent (default info)

stop:
  --timeout s      seconds to wait after SIGTERM before killing (default 10)

logs:
  -n, --lines n    how many lines to show (default 50)
  -f, --follow     keep printing as the file grows

keys create:
  --label s            human-readable label
  --claims a,b         comma-separated claims
  --preset s           root | manage | write | read (default read; ignored with --claims)
  --collections a,b    collections for read/write/manage presets (empty = all)
  --project id         project the preset's claims target (default * = all)
  --env id             environment the preset's claims target (default * = all)

export:
  --dir path           export to directory layout
  --out path           export to .tar.gz tarball
  --with-keys          include API keys in export

import:
  --mode s             merge | replace (default merge)
  --validate           strictly validate entries against schema (default false)
  --dry-run            verify import structure without writing (default false)
  --prefer s           local | remote (override conflict resolution)

Environment overrides: SILO_LISTEN, SILO_DEFAULT_PROJECT, SILO_DEFAULT_ENV,
SILO_STORAGE_DRIVER, SILO_STORAGE_PATH, SILO_BLOB_DRIVER, SILO_BLOB_PATH,
SILO_BLOB_S3_*, SILO_AUTH_DISABLED, SILO_SCHEMA_ALLOW_REMOTE_REFS,
SILO_LOG_LEVEL, SILO_LOG_FILE, SILO_LOG_FORMAT, SILO_LOG_REQUESTS,
SILO_LOG_MAX_SIZE_MB, SILO_LOG_MAX_FILES.

One server per data directory: serve refuses to start over a live one, because
two processes would allocate the same seq values and defeat the in-process
write lock. Run several instances by giving each its own --data and --listen.
Under Docker or systemd, run serve in the foreground and let the supervisor own
the process; --detach is for bare metal and development.

Project and env ids use the same grammar as collection names
(lowercase letter first, then [a-z0-9_-], max 64 chars); serve refuses to
start on an invalid default rather than creating a scope no route can reach.
Subcommands operate directly on the data dir — no running server needed.
`);
  }

  /**
   * Applies flag overrides on top of a loaded config — the top layer of
   * flags > env > file > defaults.
   *
   * Paths derived from other settings are deliberately not filled in here;
   * `--data` moves the data dir and `ConfigLoader.resolveDerivedDefaults` works
   * out what still hangs off it afterwards.
   */
  static applyFlagOverrides(cfg: Config, values: Record<string, unknown>): Config {
    if (typeof values.data === "string") {
      cfg.storage.path = values.data;
    }
    if (typeof values["blob-path"] === "string") {
      cfg.blob_storage.path = values["blob-path"];
    }
    if (typeof values.driver === "string") {
      cfg.storage.driver = values.driver;
    }
    if (typeof values.listen === "string") {
      cfg.listen = values.listen;
    }
    if (typeof values.project === "string") {
      cfg.default_project = values.project;
    }
    if (typeof values.env === "string") {
      cfg.default_env = values.env;
    }
    if (typeof values["log-file"] === "string") {
      cfg.log.file = values["log-file"];
    }
    if (typeof values["log-level"] === "string") {
      cfg.log.level = values["log-level"];
    }
    return cfg;
  }

  static async run(): Promise<void> {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        config: { type: "string", default: "silo.toml" },
        data: { type: "string" },
        "blob-path": { type: "string" },
        driver: { type: "string" },
        listen: { type: "string" },
        project: { type: "string" },
        env: { type: "string" },
        label: { type: "string" },
        preset: { type: "string" },
        collections: { type: "string" },
        claims: { type: "string" },
        force: { type: "boolean" },
        dir: { type: "string" },
        out: { type: "string" },
        "with-keys": { type: "boolean" },
        mode: { type: "string", default: "merge" },
        validate: { type: "boolean" },
        "dry-run": { type: "boolean" },
        prefer: { type: "string" },
        detach: { type: "boolean", short: "d" },
        "log-file": { type: "string" },
        "log-level": { type: "string" },
        follow: { type: "boolean", short: "f" },
        lines: { type: "string", short: "n" },
        timeout: { type: "string" },
        help: { type: "boolean", short: "h" },
      } as const,
      strict: false,
      allowPositionals: true,
    });

    const cmd = positionals[0];
    if (!cmd || cmd === "help" || values.help) {
      Cli.printUsage();
      process.exit(cmd ? 0 : 2);
    }

    if (cmd === "version") {
      console.log("silo", Cli.version);
      process.exit(0);
    }

    const configPath = typeof values.config === "string" ? values.config : "silo.toml";

    // Handled before the config is loaded and before storage is opened: `init`
    // writes the file the other commands read, so an absent --config is the
    // normal case rather than the error loadConfig makes of it, and scaffolding
    // a config must not create a data dir as a side effect.
    if (cmd === "init") {
      try {
        await InitCommand.run(configPath, !!values.force);
      } catch (err: any) {
        console.error(`silo: ${err.message}`);
        process.exit(1);
      }
      process.exit(0);
    }

    // Load config hierarchy
    let explicitConfig = false;
    const rawArgs = process.argv.slice(2);
    if (rawArgs.includes("--config")) {
      explicitConfig = true;
    }

    const loaded = await ConfigLoader.loadConfig(configPath, explicitConfig);
    const cfg = ConfigLoader.resolveDerivedDefaults(Cli.applyFlagOverrides(loaded, values));

    // Process management, handled before storage is opened — the same reason
    // `init` is: none of these commands *is* the server, and asking whether one
    // is running, or reading its log, must not create a data directory or take
    // a handle on a database another process owns. `serve --detach` in
    // particular has to leave the data dir untouched for the child it spawns.
    try {
      if (cmd === "serve" && values.detach) {
        await ServeDetachedCommand.run(cfg, Cli.version);
        process.exit(0);
      }
      if (cmd === "stop") {
        await StopCommand.run(cfg, Cli.seconds(values.timeout, Daemon.StopTimeoutMs));
        process.exit(0);
      }
      if (cmd === "status") {
        await StatusCommand.run(cfg);
        process.exit(0);
      }
      if (cmd === "logs") {
        await LogsCommand.run(cfg, Cli.count(values.lines, 50), !!values.follow);
        process.exit(0);
      }
    } catch (err: any) {
      console.error(`silo: ${err.message}`);
      process.exit(1);
    }

    // Initialize service
    let store: any;
    if (cfg.storage.driver === "sqlite") {
      store = await SqliteStore.open(path.join(cfg.storage.path, "silo.db"));
    } else if (cfg.storage.driver === "fs") {
      store = await FsStore.open(cfg.storage.path);
    } else {
      console.error(`unknown storage driver "${cfg.storage.driver}"`);
      process.exit(1);
    }

    const blobStore = BlobStorageFactory.create(cfg.blob_storage);

    const svc = new Service(store, {
      allowRemoteRefs: cfg.schema.allow_remote_refs,
      blobStore,
    });


    // Only `serve` logs: every other subcommand writes *program output* to
    // stdout — data the caller pipes somewhere — and routing that into a log
    // file would take the answer away from whoever asked for it.
    const logger = cmd === "serve" ? Logger.create(cfg.log) : Logger.silent();

    try {
      switch (cmd) {
        case "serve":
          await ServeCommand.run(svc, cfg, Cli.version, store, logger);
          break;
        case "keys":
          await KeysCommand.run(svc, store, positionals, values);
          break;
        case "export":
          await ExportCommand.run(svc, store, values, Cli.version);
          break;
        case "import":
          await ImportCommand.run(svc, store, positionals, values);
          break;
        case "media":
          await MediaCommand.run(svc, positionals);
          break;
        default:
          console.error(`silo: unknown command "${cmd}"`);
          Cli.printUsage();
          process.exit(2);
      }
    } catch (err: any) {
      console.error(`silo: ${err.message}`);
      await logger.close().catch(() => {});
      await store.close().catch(() => {});
      process.exit(1);
    }
  }

  /** A `--timeout` in seconds, as milliseconds. Anything unparseable keeps the
   *  default rather than collapsing to zero, which would kill immediately. */
  private static seconds(value: unknown, fallbackMs: number): number {
    const parsed = typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1000 : fallbackMs;
  }

  private static count(value: unknown, fallback: number): number {
    const parsed = typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }
}
