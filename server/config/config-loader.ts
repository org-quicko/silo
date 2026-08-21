import fs from "fs/promises";
import path from "path";
import { TOML } from "bun";
import type { Config } from "./config";

export class ConfigLoader {
  static defaultConfig(): Config {
    return {
      listen: ":8090",
      default_project: "default",
      default_env: "prod",
      storage: {
        driver: "sqlite",
        path: "./silo_data",
      },
      blob_storage: {
        // No path: an unset fs path means "wherever the data dir is", resolved
        // by resolveDerivedDefaults() once flags have had their say. Baking the
        // default in here would make it indistinguishable from a path the user
        // chose, and --data would have to either clobber both or neither.
        driver: "fs",
      },
      auth: {
        disabled: false,
      },
      schema: {
        allow_remote_refs: false,
      },
      search: {
        enabled: true,
        tokenizer: "unicode61",
        max_entry_bytes: 65536,
        scan_limit: 20000,
        scan_time_budget_ms: 3000,
      },
      log: {
        level: "info",
        // No file: unset means the console, and a detached run derives
        // <data dir>/silo.log. Same rule as the fs blob path — a literal
        // default could not be told apart from a chosen one, and would send a
        // containerised silo into a file instead of the stream its supervisor
        // is reading.
        format: "text",
        requests: true,
        max_size_mb: 10,
        max_files: 5,
      },
    };
  }

  static async loadConfig(configPath: string = "silo.toml", explicit: boolean = false): Promise<Config> {
    const cfg = this.defaultConfig();

    try {
      const stat = await fs.stat(configPath);
      if (stat.isFile()) {
        const dataStr = await fs.readFile(configPath, "utf8");
        const parsed = TOML.parse(dataStr) as any;

        if (parsed) {
          if (typeof parsed.listen === "string") {
            cfg.listen = parsed.listen;
          }
          if (typeof parsed.default_project === "string") {
            cfg.default_project = parsed.default_project;
          }
          if (typeof parsed.default_env === "string") {
            cfg.default_env = parsed.default_env;
          }
          if (parsed.storage && typeof parsed.storage === "object") {
            if (typeof parsed.storage.driver === "string") {
              cfg.storage.driver = parsed.storage.driver;
            }
            if (typeof parsed.storage.path === "string") {
              cfg.storage.path = parsed.storage.path;
            }
          }
          if (parsed.blob_storage && typeof parsed.blob_storage === "object") {
            if (typeof parsed.blob_storage.driver === "string") {
              cfg.blob_storage.driver = parsed.blob_storage.driver;
            }
            if (typeof parsed.blob_storage.path === "string") {
              cfg.blob_storage.path = parsed.blob_storage.path;
            }
            if (typeof parsed.blob_storage.bucket === "string") {
              cfg.blob_storage.bucket = parsed.blob_storage.bucket;
            }
            if (typeof parsed.blob_storage.region === "string") {
              cfg.blob_storage.region = parsed.blob_storage.region;
            }
            if (typeof parsed.blob_storage.endpoint === "string") {
              cfg.blob_storage.endpoint = parsed.blob_storage.endpoint;
            }
            if (typeof parsed.blob_storage.access_key_id === "string") {
              cfg.blob_storage.accessKeyId = parsed.blob_storage.access_key_id;
            }
            if (typeof parsed.blob_storage.secret_access_key === "string") {
              cfg.blob_storage.secretAccessKey = parsed.blob_storage.secret_access_key;
            }
            if (typeof parsed.blob_storage.force_path_style === "boolean") {
              cfg.blob_storage.forcePathStyle = parsed.blob_storage.force_path_style;
            }
          }
          if (parsed.auth && typeof parsed.auth === "object") {
            if (typeof parsed.auth.disabled === "boolean") {
              cfg.auth.disabled = parsed.auth.disabled;
            }
          }
          if (parsed.schema && typeof parsed.schema === "object") {
            if (typeof parsed.schema.allow_remote_refs === "boolean") {
              cfg.schema.allow_remote_refs = parsed.schema.allow_remote_refs;
            }
          }
          if (parsed.search && typeof parsed.search === "object") {
            if (typeof parsed.search.enabled === "boolean") {
              cfg.search.enabled = parsed.search.enabled;
            }
            if (parsed.search.tokenizer === "unicode61" || parsed.search.tokenizer === "trigram") {
              cfg.search.tokenizer = parsed.search.tokenizer;
            }
            for (const key of ["max_entry_bytes", "scan_limit", "scan_time_budget_ms"] as const) {
              if (typeof parsed.search[key] === "number" && parsed.search[key] > 0) {
                cfg.search[key] = parsed.search[key];
              }
            }
          }
          if (parsed.log && typeof parsed.log === "object") {
            if (typeof parsed.log.level === "string") {
              cfg.log.level = parsed.log.level;
            }
            if (typeof parsed.log.file === "string") {
              cfg.log.file = parsed.log.file;
            }
            if (typeof parsed.log.format === "string") {
              cfg.log.format = parsed.log.format;
            }
            if (typeof parsed.log.requests === "boolean") {
              cfg.log.requests = parsed.log.requests;
            }
            if (typeof parsed.log.max_size_mb === "number") {
              cfg.log.max_size_mb = parsed.log.max_size_mb;
            }
            if (typeof parsed.log.max_files === "number") {
              cfg.log.max_files = parsed.log.max_files;
            }
          }
        }
      }
    } catch (err: any) {
      if (explicit) {
        throw new Error(`config ${configPath}: ${err.message}`);
      }
    }

    // Environment overrides
    if (process.env.SILO_LISTEN) {
      cfg.listen = process.env.SILO_LISTEN;
    }
    if (process.env.SILO_DEFAULT_PROJECT) {
      cfg.default_project = process.env.SILO_DEFAULT_PROJECT;
    }
    if (process.env.SILO_DEFAULT_ENV) {
      cfg.default_env = process.env.SILO_DEFAULT_ENV;
    }
    if (process.env.SILO_STORAGE_DRIVER) {
      cfg.storage.driver = process.env.SILO_STORAGE_DRIVER;
    }
    if (process.env.SILO_STORAGE_PATH) {
      cfg.storage.path = process.env.SILO_STORAGE_PATH;
    }
    if (process.env.SILO_BLOB_DRIVER) {
      cfg.blob_storage.driver = process.env.SILO_BLOB_DRIVER;
    }
    if (process.env.SILO_BLOB_PATH) {
      cfg.blob_storage.path = process.env.SILO_BLOB_PATH;
    }
    if (process.env.SILO_BLOB_S3_BUCKET) {
      cfg.blob_storage.bucket = process.env.SILO_BLOB_S3_BUCKET;
    }
    if (process.env.SILO_BLOB_S3_REGION) {
      cfg.blob_storage.region = process.env.SILO_BLOB_S3_REGION;
    }
    if (process.env.SILO_BLOB_S3_ENDPOINT) {
      cfg.blob_storage.endpoint = process.env.SILO_BLOB_S3_ENDPOINT;
    }
    if (process.env.SILO_BLOB_S3_ACCESS_KEY_ID) {
      cfg.blob_storage.accessKeyId = process.env.SILO_BLOB_S3_ACCESS_KEY_ID;
    }
    if (process.env.SILO_BLOB_S3_SECRET_ACCESS_KEY) {
      cfg.blob_storage.secretAccessKey = process.env.SILO_BLOB_S3_SECRET_ACCESS_KEY;
    }
    if (process.env.SILO_BLOB_S3_FORCE_PATH_STYLE) {
      cfg.blob_storage.forcePathStyle = process.env.SILO_BLOB_S3_FORCE_PATH_STYLE === "true";
    }
    if (process.env.SILO_AUTH_DISABLED) {
      cfg.auth.disabled = process.env.SILO_AUTH_DISABLED === "true";
    }
    if (process.env.SILO_SEARCH_ENABLED) {
      cfg.search.enabled = process.env.SILO_SEARCH_ENABLED === "true";
    }
    if (process.env.SILO_SEARCH_TOKENIZER === "unicode61" || process.env.SILO_SEARCH_TOKENIZER === "trigram") {
      cfg.search.tokenizer = process.env.SILO_SEARCH_TOKENIZER;
    }
    if (process.env.SILO_SCHEMA_ALLOW_REMOTE_REFS) {
      cfg.schema.allow_remote_refs = process.env.SILO_SCHEMA_ALLOW_REMOTE_REFS === "true";
    }
    if (process.env.SILO_LOG_LEVEL) {
      cfg.log.level = process.env.SILO_LOG_LEVEL;
    }
    if (process.env.SILO_LOG_FILE) {
      cfg.log.file = process.env.SILO_LOG_FILE;
    }
    if (process.env.SILO_LOG_FORMAT) {
      cfg.log.format = process.env.SILO_LOG_FORMAT;
    }
    if (process.env.SILO_LOG_REQUESTS) {
      cfg.log.requests = process.env.SILO_LOG_REQUESTS === "true";
    }
    if (process.env.SILO_LOG_MAX_SIZE_MB) {
      const mb = Number(process.env.SILO_LOG_MAX_SIZE_MB);
      if (Number.isFinite(mb)) cfg.log.max_size_mb = mb;
    }
    if (process.env.SILO_LOG_MAX_FILES) {
      const files = Number(process.env.SILO_LOG_MAX_FILES);
      if (Number.isFinite(files)) cfg.log.max_files = files;
    }

    return cfg;
  }

  /**
   * Fills in the defaults that are derived from other settings, after every
   * layer of the hierarchy (file, env, flags) has been applied.
   *
   * The fs blob path follows the data dir, so that `--data /tmp/foo` keeps one
   * instance in one place instead of putting SQLite under /tmp/foo and media
   * under ./silo_data/media. An explicit `[blob_storage] path`, `SILO_BLOB_PATH`
   * or `--blob-path` is left alone — the point of leaving it unset by default is
   * that a chosen path stays chosen.
   *
   * Call this last. Anything applied afterwards can no longer tell a derived
   * value from an explicit one.
   */
  static resolveDerivedDefaults(cfg: Config): Config {
    // Normalised the way BlobStorageFactory reads it, so a driver spelled "FS"
    // cannot get past this and fall back to a path under the wrong directory.
    const blobDriver = (cfg.blob_storage.driver || "fs").toLowerCase();
    if (blobDriver === "fs" && !cfg.blob_storage.path) {
      cfg.blob_storage.path = path.join(cfg.storage.path, "media");
    }
    return cfg;
  }
}
