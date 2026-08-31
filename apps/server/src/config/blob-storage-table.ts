import type { BlobStorageConfig } from "./blob-storage-config";
import { TomlTableEdit } from "./toml-table-edit";

/**
 * Reading and rewriting the `[blob_storage]` table of a `silo.toml` (D45).
 *
 * Both halves live here because they have to agree on one thing — which TOML
 * key carries which field — and a reader that spelled `access_key_id` the way
 * `ConfigLoader` does while the writer spelled it otherwise would produce a
 * file that saves cleanly and loads as nothing.
 *
 * The text mechanics are `TomlTableEdit`'s, shared with `MediaTable`: the edit
 * is text so comments outside the table survive, and the result is parsed
 * before it is written so an edit that would have changed anything else is
 * abandoned rather than saved.
 */
export class BlobStorageTable {
  static readonly Table = "blob_storage";

  /** The note written above the table, so a reader knows why their comments
   *  inside it are gone. Re-added on every write, since the whole span goes. */
  static readonly ManagedNote =
    "Written by PUT /api/media/storage. Editing it here is still fine; " +
    "the admin reads this file back.";

  /**
   * What **the file** says, which is not what the instance is running: env vars
   * and flags sit above it (§10).
   *
   * That distinction is the whole reason this exists. A save merges over the
   * file's own values, so a secret supplied through
   * `SILO_BLOB_S3_SECRET_ACCESS_KEY` is never copied into the file by an
   * operator who edited an unrelated field — which would take a credential out
   * of the environment it was deliberately put in.
   *
   * `null` when there is no file or it has no such table; `{}` fields stay
   * undefined rather than defaulted, because unset and empty differ here.
   */
  static async read(configPath: string): Promise<BlobStorageConfig | null> {
    return BlobStorageTable.fromTable(await TomlTableEdit.read(configPath, BlobStorageTable.Table));
  }

  /** One TOML table as a `BlobStorageConfig`. The single place the two key
   *  spellings meet, read by `read` and by the write-back check. */
  static fromTable(table: any): BlobStorageConfig | null {
    if (!table || typeof table !== "object") return null;

    return {
      driver: typeof table.driver === "string" ? table.driver : "fs",
      ...(typeof table.path === "string" ? { path: table.path } : {}),
      ...(typeof table.bucket === "string" ? { bucket: table.bucket } : {}),
      ...(typeof table.region === "string" ? { region: table.region } : {}),
      ...(typeof table.endpoint === "string" ? { endpoint: table.endpoint } : {}),
      ...(typeof table.access_key_id === "string" ? { accessKeyId: table.access_key_id } : {}),
      ...(typeof table.secret_access_key === "string"
        ? { secretAccessKey: table.secret_access_key }
        : {}),
      ...(typeof table.force_path_style === "boolean"
        ? { forcePathStyle: table.force_path_style }
        : {}),
    };
  }

  static async write(configPath: string, next: BlobStorageConfig): Promise<boolean> {
    const normalized = BlobStorageTable.normalize(next);
    return TomlTableEdit.write(configPath, {
      table: BlobStorageTable.Table,
      note: BlobStorageTable.ManagedNote,
      rendered: BlobStorageTable.render(normalized),
      verify: (written) =>
        JSON.stringify(BlobStorageTable.fromTable(written)) === JSON.stringify(normalized),
    });
  }

  /**
   * The table as TOML. Only keys that are set are written: an unset
   * `[blob_storage] path` means "follow the data dir" and a literal one would
   * pin media in place, which is the derivation §10 exists to protect.
   */
  static render(config: BlobStorageConfig): string {
    const lines = TomlTableEdit.header(BlobStorageTable.Table, BlobStorageTable.ManagedNote);
    const put = (key: string, value: string | boolean | undefined) => {
      if (value === undefined || value === "") return;
      lines.push(`${key.padEnd(17)} = ${JSON.stringify(value)}`);
    };

    put("driver", config.driver);
    put("path", config.path);
    put("bucket", config.bucket);
    put("region", config.region);
    put("endpoint", config.endpoint);
    put("access_key_id", config.accessKeyId);
    put("secret_access_key", config.secretAccessKey);
    if (config.forcePathStyle !== undefined) {
      lines.push(`${"force_path_style".padEnd(17)} = ${config.forcePathStyle}`);
    }

    return `${lines.join("\n")}\n`;
  }

  /**
   * A config in the shape `fromTable` answers in, so the two are comparable.
   *
   * The key order is `fromTable`'s on purpose — the write-back check compares
   * them as JSON, and an object that agrees on every value while disagreeing on
   * their order would fail a check that has nothing to complain about.
   */
  private static normalize(config: BlobStorageConfig): BlobStorageConfig {
    const set = (value?: string) => (value === undefined || value === "" ? undefined : value);
    return {
      driver: config.driver || "fs",
      ...(set(config.path) ? { path: config.path } : {}),
      ...(set(config.bucket) ? { bucket: config.bucket } : {}),
      ...(set(config.region) ? { region: config.region } : {}),
      ...(set(config.endpoint) ? { endpoint: config.endpoint } : {}),
      ...(set(config.accessKeyId) ? { accessKeyId: config.accessKeyId } : {}),
      ...(set(config.secretAccessKey) ? { secretAccessKey: config.secretAccessKey } : {}),
      ...(config.forcePathStyle !== undefined ? { forcePathStyle: config.forcePathStyle } : {}),
    };
  }
}
