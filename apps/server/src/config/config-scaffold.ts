import fs from "fs/promises";
import path from "path";
import type { Config } from "./config";
import { ConfigLoader } from "./config-loader";

/**
 * Writing a `silo.toml` that is not there yet — the annotated default file
 * `silo init` produces, and the one an install creates when it has a plugin to
 * list and no file to list it in (§13.21).
 *
 * The values are rendered from `ConfigLoader.defaultConfig()` rather than
 * written out by hand, so the scaffold cannot drift from what silo does when no
 * file is present: an untouched scaffold is a no-op, and
 * `server/test/cli/init-command.test.ts` pins that by loading it back. That
 * property is what makes creating one behind an operator's back safe — file
 * values sit below flags and `SILO_*` env vars, so a file holding nothing but
 * the defaults changes nothing about the run that wrote it.
 *
 * Keys silo has no default for — the s3 credentials, the fs media dir, and the
 * log file — are emitted **commented out**, not filled in. `[blob_storage] path`
 * is the one that matters: unset means "follow the data dir", so `--data <dir>`
 * keeps uploads at `<dir>/media`; a literal path here is indistinguishable from
 * a path the user chose and would silently pin media in place (§10).
 */
export class ConfigScaffold {
  /** Write the scaffold, replacing whatever is there. */
  static async write(configPath: string): Promise<void> {
    await ConfigScaffold.put(configPath, "w");
  }

  /**
   * Write the scaffold only if nothing is at `configPath`, answering whether
   * this call created it.
   *
   * `wx` rather than a `stat` first: the check and the write are one syscall, so
   * a caller racing this one is told `false` instead of quietly replacing a file
   * that by then holds somebody's settings.
   */
  static async create(configPath: string): Promise<boolean> {
    try {
      await ConfigScaffold.put(configPath, "wx");
      return true;
    } catch (caught) {
      if ((caught as { code?: string }).code === "EEXIST") return false;
      throw caught;
    }
  }

  /** The parent directory is created; the data dir never is. Writing a config
   *  file must not open storage as a side effect. */
  private static async put(configPath: string, flag: "w" | "wx"): Promise<void> {
    const dir = path.dirname(configPath);
    if (dir && dir !== ".") await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(configPath, ConfigScaffold.render(ConfigLoader.defaultConfig()), {
      encoding: "utf8",
      flag,
    });
  }

  /** Renders a config as annotated TOML. Every key silo reads appears, set to
   *  its default or commented with the alternatives it accepts. */
  static render(config: Config): string {
    const s = (v: string) => JSON.stringify(v); // TOML basic strings are JSON strings

    return `# silo.toml — every key is optional; the values below are silo's defaults.
# Precedence: flags > SILO_* env vars > this file > defaults.

listen          = ${s(config.listen)}     # host:port to bind; ":8090" means every interface
default_project = ${s(config.default_project)}   # created on startup if missing
default_env     = ${s(config.default_env)}      # created on startup if missing

[storage]
driver = ${s(config.storage.driver)}       # "sqlite" (indexed, fast) | "fs" (plain JSON files, git/rsync friendly)
path   = ${s(config.storage.path)}  # data dir; the sqlite database lives at <path>/silo.db

[blob_storage]
driver = ${s(config.blob_storage.driver)}           # "fs" (local directory) | "s3" (S3 or S3-compatible)
# path = "/srv/silo-media"  # fs driver. Unset = <storage.path>/media, so --data moves media too; setting it pins media here.
#
# s3 driver:
# bucket            = "silo-media"   # required
# region            = "ap-south-1"
# endpoint          = "https://..."  # S3-compatible providers only; omit for AWS
# access_key_id     = "..."          # prefer SILO_BLOB_S3_ACCESS_KEY_ID — this file is not a secret store
# secret_access_key = "..."          # prefer SILO_BLOB_S3_SECRET_ACCESS_KEY
# force_path_style  = false          # true for MinIO and other path-style endpoints

[media]
# base_url        = "https://cdn.example.com"  # unset = the address each request arrived on
# base_url_target = "server"   # "server": <base>/media/<id>, streamed by silo | "store": <base>/<blob key>, needs a public bucket
extensions      = [${config.media.extensions.map((e) => s(e)).join(", ")}]
# Uploads are refused unless the filename ends in one of these. ["*"] accepts anything.
# svg can carry script and is served inline: drop it where uploaders are untrusted.

[auth]
disabled = ${config.auth.disabled}   # dev only: true treats every request as root, ignoring API keys

[schema]
allow_remote_refs = ${config.schema.allow_remote_refs}  # true fetches http(s) $refs during validation (non-deterministic writes)

[search]
enabled             = ${config.search.enabled}     # false keeps no index; search falls back to a full scan
tokenizer           = ${s(config.search.tokenizer)}  # "unicode61" (words) | "trigram" (substrings; required for CJK)
max_entry_bytes     = ${config.search.max_entry_bytes}    # per-entry cap on indexed text
scan_limit          = ${config.search.scan_limit}    # entries one un-indexed scan may visit before truncating
scan_time_budget_ms = ${config.search.scan_time_budget_ms}     # ...and how long, whichever comes first
# Changing the tokenizer rebuilds the index on the next start.

[log]
level       = ${s(config.log.level)}   # "debug" | "info" | "warn" | "error" | "silent"
format      = ${s(config.log.format)}   # "text" (human) | "json" (one object per line, for a log shipper)
requests    = ${config.log.requests}     # one line per HTTP request; its own switch because it is high volume
max_size_mb = ${config.log.max_size_mb}       # rotate past this size; 0 never rotates
max_files   = ${config.log.max_files}        # rotated files kept as silo.log.1 … silo.log.<n>
# file = "/var/log/silo.log"  # unset = the console. "serve --detach" uses <storage.path>/silo.log unless this names one.

# Plugins. An *ordered* array — the order is hook dispatch order. None by
# default: a plugin is a directory under <storage.path>/plugins/ that this
# file names. See the "Plugins" section of the README.
# [[plugins]]
# name   = "silo-plugin-slug"
# claims = ["collections:*/*/*:entries:read"]
`;
  }
}
