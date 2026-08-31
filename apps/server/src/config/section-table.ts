import type { ConfigSection } from "./config-section";
import { TomlTableEdit } from "./toml-table-edit";

/**
 * Reading and rewriting any table `ConfigSections` describes (D47).
 *
 * `BlobStorageTable` and `MediaTable` written once, driven by a spec instead of
 * by hand. The rules are still `TomlTableEdit`'s — the edit is text so comments
 * outside the table survive, the result is parsed before it is written, and the
 * write is abandoned unless the rest of the document reads back identical.
 *
 * Every read is a **partial**: the file decides what it names and nothing else,
 * so a `[log]` setting only `level` must not read as one that also reset the
 * rotation settings to silo's defaults.
 */
export class SectionTable {
  static note(section: ConfigSection): string {
    return (
      `Written by PUT /api/settings/${section.table}. Editing it here is still fine; ` +
      `the admin reads this file back.`
    );
  }

  static async read(
    configPath: string,
    section: ConfigSection
  ): Promise<Record<string, unknown> | null> {
    return SectionTable.fromTable(section, await TomlTableEdit.read(configPath, section.table));
  }

  /**
   * One TOML table as the fields it actually set, in the spec's order.
   *
   * The order matters and is not cosmetic: the write-back check compares this
   * against the normalised input as JSON, and two objects agreeing on every
   * value while disagreeing on key order would fail a check with nothing to
   * complain about.
   */
  static fromTable(section: ConfigSection, table: any): Record<string, unknown> | null {
    if (!table || typeof table !== "object") return null;

    const out: Record<string, unknown> = {};
    for (const field of section.fields) {
      const value = table[field.key];
      if (value === undefined || value === null) continue;

      if (field.type === "boolean" && typeof value === "boolean") out[field.key] = value;
      else if (field.type === "number" && typeof value === "number") out[field.key] = value;
      else if (field.type === "enum" && field.values?.includes(String(value))) {
        out[field.key] = String(value);
      } else if (field.type === "string" && typeof value === "string") out[field.key] = value;
    }
    return out;
  }

  static async write(
    configPath: string,
    section: ConfigSection,
    next: Record<string, unknown>
  ): Promise<boolean> {
    const normalized = SectionTable.normalize(section, next);
    return TomlTableEdit.write(configPath, {
      table: section.table,
      note: SectionTable.note(section),
      rendered: SectionTable.render(section, normalized),
      verify: (written) =>
        JSON.stringify(SectionTable.fromTable(section, written)) === JSON.stringify(normalized),
    });
  }

  /**
   * The table as TOML.
   *
   * An unset value is left out rather than written as an empty string, so a
   * `[log] file` nobody named stays absent and keeps meaning "the console" —
   * the derived-default rule §10 states, and the one `ConfigScaffold` writes
   * its own examples commented out to protect.
   */
  static render(section: ConfigSection, config: Record<string, unknown>): string {
    const lines = TomlTableEdit.header(section.table, SectionTable.note(section));
    const width = Math.max(...section.fields.map((field) => field.key.length));

    for (const field of section.fields) {
      const value = config[field.key];
      if (value === undefined) continue;
      lines.push(`${field.key.padEnd(width)} = ${JSON.stringify(value)}`);
    }

    return `${lines.join("\n")}\n`;
  }

  /** The shape `fromTable` answers in, so the two are comparable. */
  private static normalize(
    section: ConfigSection,
    config: Record<string, unknown>
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of section.fields) {
      const value = config[field.key];
      if (value === undefined || value === null) continue;
      if (field.type === "string" && value === "") continue;
      out[field.key] = value;
    }
    return out;
  }
}
