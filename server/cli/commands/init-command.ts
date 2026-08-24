import fs from "fs/promises";
import path from "path";
import type { Config } from "../../config/config";
import { ConfigLoader } from "../../config/config-loader";

/**
 * `silo init` — scaffolds a `silo.toml` holding silo's default settings.
 *
 * The values are rendered from `ConfigLoader.defaultConfig()` rather than
 * written out by hand, so the scaffold cannot drift from what silo actually
 * does when no file is present: an untouched `silo init` file is a no-op, and
 * `server/test/cli/init-command.test.ts` pins that by loading it back.
 *
 * Keys silo has no default for — the s3 credentials, the fs media dir, and the
 * log file — are emitted **commented out**, not filled in. `[blob_storage] path` is the
 * one that matters: unset means "follow the data dir", so `--data <dir>` keeps
 * uploads at `<dir>/media`; a literal path here is indistinguishable from a
 * path the user chose and would silently pin media in place (§10).
 *
 * Runs before any storage is opened — writing a config file must not create a
 * data dir as a side effect, and `--config` naming a file that does not exist
 * yet is the normal case rather than an error.
 */
export class InitCommand {
  static async run(configPath: string, force: boolean): Promise<void> {
    if (!force && (await InitCommand.exists(configPath))) {
      throw new Error(`${configPath} already exists — pass --force to overwrite it`);
    }

    const dir = path.dirname(configPath);
    if (dir && dir !== ".") {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(configPath, InitCommand.render(ConfigLoader.defaultConfig()), "utf8");

    console.log(`wrote default config: ${configPath}`);
  }

  private static async exists(file: string): Promise<boolean> {
    try {
      await fs.stat(file);
      return true;
    } catch {
      return false;
    }
  }

  /** Renders a config as annotated TOML. Every key silo reads appears, set to
   *  its default or commented with the alternatives it accepts. */
  static render(cfg: Config): string {
    const s = (v: string) => JSON.stringify(v); // TOML basic strings are JSON strings

    return `# silo.toml — every key is optional; the values below are silo's defaults.
# Precedence: flags > SILO_* env vars > this file > defaults.

listen          = ${s(cfg.listen)}     # host:port to bind; ":8090" means every interface
default_project = ${s(cfg.default_project)}   # created on startup if missing
default_env     = ${s(cfg.default_env)}      # created on startup if missing

[storage]
driver = ${s(cfg.storage.driver)}       # "sqlite" (indexed, fast) | "fs" (plain JSON files, git/rsync friendly)
path   = ${s(cfg.storage.path)}  # data dir; the sqlite database lives at <path>/silo.db

[blob_storage]
driver = ${s(cfg.blob_storage.driver)}           # "fs" (local directory) | "s3" (S3 or S3-compatible)
# path = "/srv/silo-media"  # fs driver. Unset = <storage.path>/media, so --data moves media too; setting it pins media here.
#
# s3 driver:
# bucket            = "silo-media"   # required
# region            = "ap-south-1"
# endpoint          = "https://..."  # S3-compatible providers only; omit for AWS
# access_key_id     = "..."          # prefer SILO_BLOB_S3_ACCESS_KEY_ID — this file is not a secret store
# secret_access_key = "..."          # prefer SILO_BLOB_S3_SECRET_ACCESS_KEY
# force_path_style  = false          # true for MinIO and other path-style endpoints

[auth]
disabled = ${cfg.auth.disabled}   # dev only: true treats every request as root, ignoring API keys

[schema]
allow_remote_refs = ${cfg.schema.allow_remote_refs}  # true fetches http(s) $refs during validation (non-deterministic writes)

[search]
enabled             = ${cfg.search.enabled}     # false keeps no index; search falls back to a full scan
tokenizer           = ${s(cfg.search.tokenizer)}  # "unicode61" (words) | "trigram" (substrings; required for CJK)
max_entry_bytes     = ${cfg.search.max_entry_bytes}    # per-entry cap on indexed text
scan_limit          = ${cfg.search.scan_limit}    # entries one un-indexed scan may visit before truncating
scan_time_budget_ms = ${cfg.search.scan_time_budget_ms}     # ...and how long, whichever comes first
# Changing the tokenizer rebuilds the index on the next start.

[log]
level       = ${s(cfg.log.level)}   # "debug" | "info" | "warn" | "error" | "silent"
format      = ${s(cfg.log.format)}   # "text" (human) | "json" (one object per line, for a log shipper)
requests    = ${cfg.log.requests}     # one line per HTTP request; its own switch because it is high volume
max_size_mb = ${cfg.log.max_size_mb}       # rotate past this size; 0 never rotates
max_files   = ${cfg.log.max_files}        # rotated files kept as silo.log.1 … silo.log.<n>
# file = "/var/log/silo.log"  # unset = the console. "serve --detach" uses <storage.path>/silo.log unless this names one.
`;
  }
}
