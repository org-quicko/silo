import fs from "fs/promises";
import { TOML } from "bun";
import { ValidationError } from "@silo/shared/validation-error";
import { ConfigScaffold } from "./config-scaffold";

/**
 * Replacing one table of a `silo.toml` as text, and refusing to if that would
 * change anything else.
 *
 * Lifted out of `BlobStorageTable` when `[media]` became the second table an
 * API writes (D46). The rules are that file's, and they are the rules because
 * the failure they prevent is silent: an edit that corrupts a neighbouring
 * table is discovered at the next start, not at the write.
 *
 *  - The edit is **text**, so every comment outside the table survives.
 *  - The result is **parsed before it is written**, and abandoned unless the
 *    rest of the document reads back identical and the table reads back as
 *    what was asked for.
 *  - Lines are split on `"\n"` only, so a `"\r"` stays attached to its line
 *    and a CRLF file is not quietly rewritten to LF around the edit.
 *
 * A refusal is a `ValidationError`, not a plain one: every one of them is a
 * statement about the document an operator has to go and fix, and the settings
 * APIs answering `500 internal error` to "edit the table by hand" would hide
 * the only sentence worth reading.
 *
 * What it does not do is preserve comments *inside* the table it replaces: the
 * whole span goes, including silo's own. That is the honest cost of editing a
 * table through an API rather than by hand, and it is bounded — nothing above
 * the header and nothing below the next one is touched.
 */
export class TomlTableEdit {
  /** The parsed table, or `null` when there is no file or no such table. */
  static async read(configPath: string, table: string): Promise<any | null> {
    let text: string;
    try {
      text = await fs.readFile(configPath, "utf8");
    } catch {
      return null;
    }

    const parsed = (TOML.parse(text) as any)?.[table];
    return parsed && typeof parsed === "object" ? parsed : null;
  }

  /**
   * Replaces `table` with `rendered`, or appends it when the file has none.
   * Returns whether the file had to be created first.
   *
   * `verify` is asked of the **parsed** result, never of the text, which is
   * what catches every way a line-range edit goes wrong at once: a span that
   * ran into the next table, a document that wrote this table as an inline
   * one or as dotted keys, a value that did not round trip.
   */
  static async write(
    configPath: string,
    edit: { table: string; note: string; rendered: string; verify: (written: any) => boolean }
  ): Promise<boolean> {
    const created = await ConfigScaffold.create(configPath);
    const text = await fs.readFile(configPath, "utf8");

    const lines = text.split("\n");
    const span = TomlTableEdit.span(lines, edit.table, edit.note);
    const table = edit.rendered.split("\n");

    const merged = span
      ? [...lines.slice(0, span.start), ...table, ...lines.slice(span.end)]
      : [...TomlTableEdit.trimTrailingBlanks(lines), "", ...table];

    const result = merged.join("\n");
    TomlTableEdit.assertWrites(text, result, edit, configPath);
    await fs.writeFile(configPath, result, "utf8");
    return created;
  }

  /** The header line for a managed table, with silo's note above it. */
  static header(table: string, note: string): string[] {
    return [`# ${note}`, `[${table}]`];
  }

  /**
   * The lines `[<table>]` occupies: its header, its keys, and silo's own note
   * above it. `null` when the file has no such table.
   *
   * The table ends at the next header of any kind. Neither table this is used
   * for has sub-tables — unlike `[[plugins]]`, whose `[plugins.config]` belongs
   * to the entry above it — so a header is a header.
   */
  private static span(
    lines: string[],
    table: string,
    note: string
  ): { start: number; end: number } | null {
    let header: number | null = null;
    let end = lines.length;

    for (let index = 0; index < lines.length; index++) {
      const trimmed = lines[index]!.trim();
      if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) continue;
      if (header === null) {
        if (trimmed === `[${table}]`) header = index;
        continue;
      }
      end = index;
      break;
    }

    if (header === null) return null;

    let start = header;
    while (start > 0 && lines[start - 1]!.trim().startsWith(`# ${note}`)) start--;
    return { start, end };
  }

  private static assertWrites(
    before: string,
    after: string,
    edit: { table: string; verify: (written: any) => boolean },
    configPath: string
  ): void {
    let parsed: any;
    try {
      parsed = TOML.parse(after);
    } catch (caught) {
      throw new ValidationError(
        `writing [${edit.table}] to ${configPath} would have produced a file TOML cannot ` +
          `read (${(caught as Error).message}), so nothing was written.`
      );
    }

    const rest = (document: any) => {
      const { [edit.table]: _dropped, ...others } = document ?? {};
      return JSON.stringify(others);
    };

    if (rest(TOML.parse(before)) !== rest(parsed)) {
      throw new ValidationError(
        `writing [${edit.table}] to ${configPath} would have changed the rest of the file, ` +
          `so nothing was written. Edit the table by hand.`
      );
    }

    if (!edit.verify(parsed?.[edit.table])) {
      throw new ValidationError(
        `[${edit.table}] did not read back as it was written in ${configPath}, ` +
          `so nothing was written.`
      );
    }
  }

  /** Trailing blank lines, dropped so an appended table gets exactly one blank
   *  line above it however the file happened to end. */
  private static trimTrailingBlanks(lines: string[]): string[] {
    const kept = [...lines];
    while (kept.length > 0 && kept[kept.length - 1]!.trim() === "") kept.pop();
    return kept;
  }
}
