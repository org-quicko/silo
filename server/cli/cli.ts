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
import { MediaCommand } from "./commands/media-command";
import { KeysCommand } from "./commands/keys-command";
import { ServeCommand } from "./commands/serve-command";

/** Argv parsing, subcommand routing, and dependency wiring for the silo CLI. */
export class Cli {
  private static readonly version = "0.1.0-dev";

  private static printUsage() {
    console.log(`silo, minimal portable headless CMS

Usage:
  silo serve [flags]                     start the server
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

serve:
  --listen addr   listen address (default :8090)
  --project id    default project created on startup (default "default")
  --env id        default environment created on startup (default "prod")

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
SILO_BLOB_S3_*, SILO_AUTH_DISABLED, SILO_SCHEMA_ALLOW_REMOTE_REFS.

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

    // Load config hierarchy
    let explicitConfig = false;
    const rawArgs = process.argv.slice(2);
    if (rawArgs.includes("--config")) {
      explicitConfig = true;
    }

    const configPath = typeof values.config === "string" ? values.config : undefined;
    const loaded = await ConfigLoader.loadConfig(configPath, explicitConfig);
    const cfg = ConfigLoader.resolveDerivedDefaults(Cli.applyFlagOverrides(loaded, values));

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


    try {
      switch (cmd) {
        case "serve":
          await ServeCommand.run(svc, cfg, Cli.version, store);
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
      await store.close().catch(() => {});
      process.exit(1);
    }
  }
}
