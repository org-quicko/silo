import path from "path";
import { parseArgs } from "util";
import { SqliteStore } from "../adapters/storage/sqlite/sqlite-store";
import { PluginLoader, PluginRegistry, ProviderRegistry } from "../plugins";
import { PluginCommand } from "./commands/plugin-command";
import { SearchTokenizers } from "../core/search/search-tokenizers";
import type { Config } from "../config/config";
import { ConfigLoader } from "../config/config-loader";
import { Service } from "../core/service/service";
import { ExportCommand } from "./commands/export-command";
import { ImportCommand } from "./commands/import-command";
import { InitCommand } from "./commands/init-command";
import { LogsCommand } from "./commands/logs-command";
import { MediaCommand } from "./commands/media-command";
import { SearchCommand } from "./commands/search-command";
import { KeysCommand } from "./commands/keys-command";
import { ServeCommand } from "./commands/serve-command";
import { ServeDetachedCommand } from "./commands/serve-detached-command";
import { StatusCommand } from "./commands/status-command";
import { StopCommand } from "./commands/stop-command";
import { Logger } from "../logging/logger";
import { Daemon } from "../runtime/daemon";
import { SiloVersion } from "../version";

/** Argv parsing, subcommand routing, and dependency wiring for the silo CLI. */
export class Cli {
  private static readonly version = SiloVersion;

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
  silo search reindex [--check]          rebuild the search index (--check validates it too)
  silo plugin list                       configured plugins and what they attach to
  silo plugin info <name>                a plugin's manifest, claims and config schema
  silo plugin doctor                     load every plugin, report failures, exit
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
        check: { type: "boolean" },
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

    // Storage, through the provider registry (D31/§13.7). The built-ins are
    // registered under reserved names rather than branched on here, so a
    // third-party adapter reaches the same lookup the shipped ones do — and a
    // default install still resolves "sqlite" to SqliteStore with no plugin,
    // no network and no configuration.
    const providers = ProviderRegistry.withBuiltins();
    let store: any;
    let blobStore: any;
    const tokenizer = SearchTokenizers.sqlite(cfg.search.tokenizer);
    try {
      // Before storage is opened, because a provider plugin *is* the storage.
      await PluginLoader.loadProviders(PluginRegistry.directory(cfg), cfg.plugins, providers);
      store = await providers.openStorage(cfg);
      blobStore = providers.openBlob(cfg.blob_storage);
    } catch (err: any) {
      console.error(`silo: ${err.message}`);
      process.exit(1);
    }

    // The native engine when this build has FTS5 and search is on, the
    // portable one otherwise (D30). `createSearcher` returns null rather than
    // throwing, because a SQLite without FTS5 cannot be repaired at runtime —
    // the shipped build sets OMIT_LOAD_EXTENSION — so it must degrade.
    const searcher =
      store instanceof SqliteStore ? store.createSearcher(tokenizer) ?? undefined : undefined;

    const svc = new Service(store, {
      allowRemoteRefs: cfg.schema.allow_remote_refs,
      blobStore,
      searcher,
      scan: { visitLimit: cfg.search.scan_limit, timeBudgetMs: cfg.search.scan_time_budget_ms },
    });

    // Before the bind, never after: a half-filled index answers with a subset
    // and nothing says so, which is worse than a slow start. Only a stamp
    // change or an empty index triggers this, so a normal start does no work.
    if (store instanceof SqliteStore && store.needsSearchRebuild() && searcher) {
      const report = await searcher.reindex();
      store.searchRebuilt();
      if (cmd === "serve" && report.entries > 0) {
        console.error(
          `silo: rebuilt the search index (${report.entries} entries in ${report.collections} collections)`
        );
      }
    }


    // Only `serve` logs: every other subcommand writes *program output* to
    // stdout — data the caller pipes somewhere — and routing that into a log
    // file would take the answer away from whoever asked for it.
    const logger = cmd === "serve" ? Logger.create(cfg.log) : Logger.silent();

    // Extension plugins load only for `serve` (D31). Every other subcommand is
    // a one-shot against the data dir, and spinning a worker per plugin to run
    // an export would pay the cold start for hooks that will never fire —
    // `doctor` is the exception, because loading them *is* what it reports on.
    let plugins = PluginRegistry.empty(logger);
    try {
      if (cmd === "serve") {
        plugins = await PluginRegistry.load(cfg, svc, logger);
        svc.useHooks(plugins.hooks());
      }
    } catch (err: any) {
      // Refuse the start rather than serve without a plugin the operator
      // configured: an instance that looks healthy and has quietly stopped
      // enforcing something is the worse outcome (§13.3).
      console.error(`silo: ${err.message}`);
      await store.close().catch(() => {});
      process.exit(1);
    }

    try {
      switch (cmd) {
        case "serve":
          await ServeCommand.run(svc, cfg, Cli.version, store, logger);
          await plugins.stop();
          break;
        case "plugin":
          await PluginCommand.run(cfg, svc, positionals);
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
        case "search":
          await SearchCommand.run(svc, positionals, values);
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
