import fs from "fs/promises";
import path from "path";
import type { Entry } from "../domain/entry";
import type { Scope } from "../domain/scope";

/**
 * One collection's entries, read when the importer reaches them.
 *
 * They used to arrive as an `Entry[]` per collection, which meant the whole
 * archive's content was parsed into memory before a single row was written —
 * a destination receiving a copy peaked at roughly twice the archive (§7.2).
 * The importer already works one collection at a time and one entry at a time,
 * so nothing needed the array; it only needed something it could iterate.
 *
 * The file *names* are still listed eagerly, because the directory has to be
 * read to know what is in it. Names are small; the entries are not.
 */
export class ImportEntries {
  private readonly open: () => AsyncIterable<Entry>;

  private constructor(open: () => AsyncIterable<Entry>) {
    this.open = open;
  }

  /** Entries already in hand — a scope copy reads them from storage (D22). */
  static of(entries: readonly Entry[]): ImportEntries {
    return new ImportEntries(async function* () {
      for (const entry of entries) yield entry;
    });
  }

  /**
   * A `content/<collection>/` directory, one `*.json` at a time.
   *
   * The scope comes from the caller, never from the file: the path is the
   * addressing authority (D18), so an entry's own `project`/`env` fields are
   * overwritten from the directory it was found in.
   */
  static inDirectory(directory: string, scope: Scope, collection: string): ImportEntries {
    return new ImportEntries(async function* () {
      const names = (await fs.readdir(directory)).filter(
        (name) => !name.startsWith(".") && name.endsWith(".json")
      );
      for (const name of names) {
        const parsed = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
        yield {
          id: parsed.id,
          project: scope.project,
          env: scope.env,
          collection,
          rev: parsed.rev,
          seq: parsed.seq,
          created_at: new Date(parsed.created_at),
          updated_at: new Date(parsed.updated_at),
          data: parsed.data,
        };
      }
    });
  }

  /** The same entries, narrowed. Lazily, so a filter costs no memory either. */
  filter(keep: (entry: Entry) => boolean): ImportEntries {
    const source = this.open;
    return new ImportEntries(async function* () {
      for await (const entry of source()) {
        if (keep(entry)) yield entry;
      }
    });
  }

  /** Re-iterable on purpose: a dry run and the run after it read the same
   *  archive, and each pass opens the directory again. */
  [Symbol.asyncIterator](): AsyncIterator<Entry> {
    return this.open()[Symbol.asyncIterator]();
  }
}
