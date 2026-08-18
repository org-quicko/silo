import fs from "fs/promises";
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
        driver: "fs",
        path: "./silo_data/media",
      },
      auth: {
        disabled: false,
      },
      schema: {
        allow_remote_refs: false,
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
    if (process.env.SILO_SCHEMA_ALLOW_REMOTE_REFS) {
      cfg.schema.allow_remote_refs = process.env.SILO_SCHEMA_ALLOW_REMOTE_REFS === "true";
    }

    return cfg;
  }
}
