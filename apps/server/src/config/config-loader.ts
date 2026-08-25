import fs from "fs/promises";
import path from "path";
import { TOML } from "bun";
import type { Config } from "./config";
import type { PluginConfig } from "./plugin-config";

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
      // No plugins unless the file names some (D31). `init` writes none, and
      // there is deliberately no SILO_PLUGINS: which code an instance runs is
      // not something an environment variable should be able to change.
      plugins: [],
    };
  }

  /** Default per-dispatch budget. Generous enough for a hook that calls out to
   *  something, short enough that a hung plugin is noticed rather than endured
   *  — and it is a ceiling on a path that can hold the write mutex (§13.9). */
  static readonly DefaultPluginTimeoutMs = 5000;

  /**
   * The ordered `[[plugins]]` array (D31/§13.8).
   *
   * Strict, unlike the settings above: an unreadable `[[plugins]]` entry throws
   * rather than falling back to a default. Every other setting has a sane
   * default that merely differs from what was asked for, whereas a mistyped
   * plugin entry means code the operator expects to be running is not — the
   * same reason `PluginLoader` refuses rather than skips.
   */
  private static plugins(raw: unknown): PluginConfig[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error(`config: [[plugins]] must be an array of tables`);

    return raw.map((entry: any, i: number) => {
      const at = `[[plugins]] #${i + 1}`;
      if (!entry || typeof entry !== "object") throw new Error(`config: ${at} is not a table`);
      if (typeof entry.name !== "string" || entry.name.length === 0) {
        throw new Error(`config: ${at} needs a "name"`);
      }
      if (entry.claims !== undefined && !Array.isArray(entry.claims)) {
        throw new Error(`config: ${at} "claims" must be an array of strings`);
      }
      if (entry.on_error !== undefined && entry.on_error !== "fail" && entry.on_error !== "skip") {
        throw new Error(`config: ${at} "on_error" must be "fail" or "skip"`);
      }
      const timeout = entry.timeout_ms ?? ConfigLoader.DefaultPluginTimeoutMs;
      if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
        throw new Error(`config: ${at} "timeout_ms" must be a positive number`);
      }
      return {
        name: entry.name,
        claims: (entry.claims ?? []).map(String),
        timeout_ms: timeout,
        on_error: entry.on_error ?? "fail",
        config: entry.config && typeof entry.config === "object" ? entry.config : {},
      };
    });
  }

  static async loadConfig(configPath: string = "silo.toml", explicit: boolean = false): Promise<Config> {
    const config = this.defaultConfig();
    let parsedFile: any = null;

    try {
      const stat = await fs.stat(configPath);
      if (stat.isFile()) {
        const dataStr = await fs.readFile(configPath, "utf8");
        const parsed = TOML.parse(dataStr) as any;

        if (parsed) {
          if (typeof parsed.listen === "string") {
            config.listen = parsed.listen;
          }
          if (typeof parsed.default_project === "string") {
            config.default_project = parsed.default_project;
          }
          if (typeof parsed.default_env === "string") {
            config.default_env = parsed.default_env;
          }
          if (parsed.storage && typeof parsed.storage === "object") {
            if (typeof parsed.storage.driver === "string") {
              config.storage.driver = parsed.storage.driver;
            }
            if (typeof parsed.storage.path === "string") {
              config.storage.path = parsed.storage.path;
            }
          }
          if (parsed.blob_storage && typeof parsed.blob_storage === "object") {
            if (typeof parsed.blob_storage.driver === "string") {
              config.blob_storage.driver = parsed.blob_storage.driver;
            }
            if (typeof parsed.blob_storage.path === "string") {
              config.blob_storage.path = parsed.blob_storage.path;
            }
            if (typeof parsed.blob_storage.bucket === "string") {
              config.blob_storage.bucket = parsed.blob_storage.bucket;
            }
            if (typeof parsed.blob_storage.region === "string") {
              config.blob_storage.region = parsed.blob_storage.region;
            }
            if (typeof parsed.blob_storage.endpoint === "string") {
              config.blob_storage.endpoint = parsed.blob_storage.endpoint;
            }
            if (typeof parsed.blob_storage.access_key_id === "string") {
              config.blob_storage.accessKeyId = parsed.blob_storage.access_key_id;
            }
            if (typeof parsed.blob_storage.secret_access_key === "string") {
              config.blob_storage.secretAccessKey = parsed.blob_storage.secret_access_key;
            }
            if (typeof parsed.blob_storage.force_path_style === "boolean") {
              config.blob_storage.forcePathStyle = parsed.blob_storage.force_path_style;
            }
          }
          if (parsed.auth && typeof parsed.auth === "object") {
            if (typeof parsed.auth.disabled === "boolean") {
              config.auth.disabled = parsed.auth.disabled;
            }
          }
          if (parsed.schema && typeof parsed.schema === "object") {
            if (typeof parsed.schema.allow_remote_refs === "boolean") {
              config.schema.allow_remote_refs = parsed.schema.allow_remote_refs;
            }
          }
          if (parsed.search && typeof parsed.search === "object") {
            if (typeof parsed.search.enabled === "boolean") {
              config.search.enabled = parsed.search.enabled;
            }
            if (parsed.search.tokenizer === "unicode61" || parsed.search.tokenizer === "trigram") {
              config.search.tokenizer = parsed.search.tokenizer;
            }
            for (const key of ["max_entry_bytes", "scan_limit", "scan_time_budget_ms"] as const) {
              if (typeof parsed.search[key] === "number" && parsed.search[key] > 0) {
                config.search[key] = parsed.search[key];
              }
            }
          }
          if (parsed.log && typeof parsed.log === "object") {
            if (typeof parsed.log.level === "string") {
              config.log.level = parsed.log.level;
            }
            if (typeof parsed.log.file === "string") {
              config.log.file = parsed.log.file;
            }
            if (typeof parsed.log.format === "string") {
              config.log.format = parsed.log.format;
            }
            if (typeof parsed.log.requests === "boolean") {
              config.log.requests = parsed.log.requests;
            }
            if (typeof parsed.log.max_size_mb === "number") {
              config.log.max_size_mb = parsed.log.max_size_mb;
            }
            if (typeof parsed.log.max_files === "number") {
              config.log.max_files = parsed.log.max_files;
            }
          }
          // Kept for after the catch: a malformed [[plugins]] entry must throw
          // whether or not --config was explicit, and this catch exists to
          // tolerate a *missing* default file, not a broken one.
          parsedFile = parsed;
        }
      }
    } catch (error: any) {
      if (explicit) {
        throw new Error(`config ${configPath}: ${error.message}`);
      }
    }

    config.plugins = ConfigLoader.plugins(parsedFile?.plugins);

    // Environment overrides
    if (process.env.SILO_LISTEN) {
      config.listen = process.env.SILO_LISTEN;
    }
    if (process.env.SILO_DEFAULT_PROJECT) {
      config.default_project = process.env.SILO_DEFAULT_PROJECT;
    }
    if (process.env.SILO_DEFAULT_ENV) {
      config.default_env = process.env.SILO_DEFAULT_ENV;
    }
    if (process.env.SILO_STORAGE_DRIVER) {
      config.storage.driver = process.env.SILO_STORAGE_DRIVER;
    }
    if (process.env.SILO_STORAGE_PATH) {
      config.storage.path = process.env.SILO_STORAGE_PATH;
    }
    if (process.env.SILO_BLOB_DRIVER) {
      config.blob_storage.driver = process.env.SILO_BLOB_DRIVER;
    }
    if (process.env.SILO_BLOB_PATH) {
      config.blob_storage.path = process.env.SILO_BLOB_PATH;
    }
    if (process.env.SILO_BLOB_S3_BUCKET) {
      config.blob_storage.bucket = process.env.SILO_BLOB_S3_BUCKET;
    }
    if (process.env.SILO_BLOB_S3_REGION) {
      config.blob_storage.region = process.env.SILO_BLOB_S3_REGION;
    }
    if (process.env.SILO_BLOB_S3_ENDPOINT) {
      config.blob_storage.endpoint = process.env.SILO_BLOB_S3_ENDPOINT;
    }
    if (process.env.SILO_BLOB_S3_ACCESS_KEY_ID) {
      config.blob_storage.accessKeyId = process.env.SILO_BLOB_S3_ACCESS_KEY_ID;
    }
    if (process.env.SILO_BLOB_S3_SECRET_ACCESS_KEY) {
      config.blob_storage.secretAccessKey = process.env.SILO_BLOB_S3_SECRET_ACCESS_KEY;
    }
    if (process.env.SILO_BLOB_S3_FORCE_PATH_STYLE) {
      config.blob_storage.forcePathStyle = process.env.SILO_BLOB_S3_FORCE_PATH_STYLE === "true";
    }
    if (process.env.SILO_AUTH_DISABLED) {
      config.auth.disabled = process.env.SILO_AUTH_DISABLED === "true";
    }
    if (process.env.SILO_SEARCH_ENABLED) {
      config.search.enabled = process.env.SILO_SEARCH_ENABLED === "true";
    }
    if (process.env.SILO_SEARCH_TOKENIZER === "unicode61" || process.env.SILO_SEARCH_TOKENIZER === "trigram") {
      config.search.tokenizer = process.env.SILO_SEARCH_TOKENIZER;
    }
    if (process.env.SILO_SCHEMA_ALLOW_REMOTE_REFS) {
      config.schema.allow_remote_refs = process.env.SILO_SCHEMA_ALLOW_REMOTE_REFS === "true";
    }
    if (process.env.SILO_LOG_LEVEL) {
      config.log.level = process.env.SILO_LOG_LEVEL;
    }
    if (process.env.SILO_LOG_FILE) {
      config.log.file = process.env.SILO_LOG_FILE;
    }
    if (process.env.SILO_LOG_FORMAT) {
      config.log.format = process.env.SILO_LOG_FORMAT;
    }
    if (process.env.SILO_LOG_REQUESTS) {
      config.log.requests = process.env.SILO_LOG_REQUESTS === "true";
    }
    if (process.env.SILO_LOG_MAX_SIZE_MB) {
      const mb = Number(process.env.SILO_LOG_MAX_SIZE_MB);
      if (Number.isFinite(mb)) config.log.max_size_mb = mb;
    }
    if (process.env.SILO_LOG_MAX_FILES) {
      const files = Number(process.env.SILO_LOG_MAX_FILES);
      if (Number.isFinite(files)) config.log.max_files = files;
    }

    return config;
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
  static resolveDerivedDefaults(config: Config): Config {
    // Normalised the way ProviderRegistry reads it, so a driver spelled "FS"
    // cannot get past this and fall back to a path under the wrong directory.
    const blobDriver = (config.blob_storage.driver || "fs").toLowerCase();
    if (blobDriver === "fs" && !config.blob_storage.path) {
      config.blob_storage.path = path.join(config.storage.path, "media");
    }
    return config;
  }
}
