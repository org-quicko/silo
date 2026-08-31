import type { MediaConfig } from "./media-config";
import { TomlTableEdit } from "./toml-table-edit";

/**
 * Reading and rewriting the `[media]` table of a `silo.toml` (D46).
 *
 * `BlobStorageTable`'s sibling, and here for the same reason: one file where
 * the reader and the writer agree on which TOML key carries which field, so a
 * table the settings page saves is a table `ConfigLoader` can load. Both share
 * `TomlTableEdit` for the text mechanics.
 *
 * Every read hands back a **partial**. The file overrides what it names and
 * nothing else, so a `[media]` that sets only `base_url` must not be read as
 * one that also cleared the extension list back to silo's default.
 */
export class MediaTable {
  static readonly Table = "media";

  static readonly ManagedNote =
    "Written by PUT /api/media/settings. Editing it here is still fine; " +
    "the admin reads this file back.";

  static async read(configPath: string): Promise<Partial<MediaConfig> | null> {
    return MediaTable.fromTable(await TomlTableEdit.read(configPath, MediaTable.Table));
  }

  /** One TOML table as the fields it actually set. */
  static fromTable(table: any): Partial<MediaConfig> | null {
    if (!table || typeof table !== "object") return null;

    return {
      ...(typeof table.base_url === "string" ? { base_url: table.base_url } : {}),
      ...(table.base_url_target === "server" || table.base_url_target === "store"
        ? { base_url_target: table.base_url_target }
        : {}),
      ...(Array.isArray(table.extensions)
        ? { extensions: MediaTable.extensions(table.extensions) }
        : {}),
    };
  }

  /**
   * A caller-supplied extension list in the form everything else expects:
   * lower case, no leading dots, no blanks, no duplicates, order preserved.
   *
   * In the config layer rather than beside the check in `MediaExtensions`
   * because `config/` imports nothing from `core/`, and both a TOML array and
   * a comma-separated `SILO_MEDIA_EXTENSIONS` arrive here needing exactly this.
   */
  static extensions(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    const out: string[] = [];
    for (const value of values) {
      if (typeof value !== "string") continue;
      const cleaned = value.trim().toLowerCase().replace(/^\.+/, "");
      if (!cleaned || out.includes(cleaned)) continue;
      out.push(cleaned);
    }
    return out;
  }

  static async write(configPath: string, next: MediaConfig): Promise<boolean> {
    const normalized = MediaTable.normalize(next);
    return TomlTableEdit.write(configPath, {
      table: MediaTable.Table,
      note: MediaTable.ManagedNote,
      rendered: MediaTable.render(normalized),
      verify: (written) =>
        JSON.stringify(MediaTable.fromTable(written)) === JSON.stringify(normalized),
    });
  }

  /**
   * The table as TOML.
   *
   * `base_url` is omitted when unset, so the request's own origin keeps
   * deciding — a literal there would pin every media URL to whichever hostname
   * the operator happened to be using when they last opened the page.
   */
  static render(config: Partial<MediaConfig>): string {
    const lines = TomlTableEdit.header(MediaTable.Table, MediaTable.ManagedNote);

    if (config.base_url) lines.push(`base_url        = ${JSON.stringify(config.base_url)}`);
    if (config.base_url_target) {
      lines.push(`base_url_target = ${JSON.stringify(config.base_url_target)}`);
    }
    if (config.extensions) {
      lines.push(
        `extensions      = [${config.extensions.map((e) => JSON.stringify(e)).join(", ")}]`
      );
    }

    return `${lines.join("\n")}\n`;
  }

  /** The shape `fromTable` answers in, key order included, so the write-back
   *  check compares two objects that can actually be equal. */
  private static normalize(config: MediaConfig): Partial<MediaConfig> {
    return {
      ...(config.base_url ? { base_url: config.base_url } : {}),
      base_url_target: config.base_url_target === "store" ? "store" : "server",
      extensions: MediaTable.extensions(config.extensions),
    };
  }
}
