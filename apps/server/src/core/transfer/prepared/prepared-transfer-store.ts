import fs from "fs/promises";
import path from "path";
import { FsFiles } from "../../../adapters/storage/fs/fs-files";
import type { Entry } from "../../domain/entry";
import { Importer } from "../importer";
import type { PackagedEntry } from "../package/packaged-entry";
import type { PreparedTransferRecord } from "./prepared-transfer-record";

/**
 * The prepared transfers on this server's disk (D109): one folder each, named
 * by its id, holding `record.json`, the verified `package/`, and
 * `entries.ndjson`, the package's entry index that the review pages through.
 *
 * Local disk is the right home because one process owns a data directory (D25,
 * D94). `record.json` is written through a synced temporary file and a rename,
 * so a restart never finds a torn one.
 */
export class PreparedTransferStore {
  static readonly RecordName = "record.json";
  static readonly PackageName = "package";
  static readonly IndexName = "entries.ndjson";

  /** A ULID. Checked before an id from a URL becomes a path. */
  private static readonly IdPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;

  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  static isId(value: string): boolean {
    return PreparedTransferStore.IdPattern.test(value);
  }

  directory(id: string): string {
    return path.join(this.root, id);
  }

  packageDirectory(id: string): string {
    return path.join(this.directory(id), PreparedTransferStore.PackageName);
  }

  /** The record, or null when there is none or `id` is not an id. */
  async read(id: string): Promise<PreparedTransferRecord | null> {
    if (!PreparedTransferStore.isId(id)) return null;
    try {
      const text = await fs.readFile(path.join(this.directory(id), PreparedTransferStore.RecordName), "utf8");
      return JSON.parse(text) as PreparedTransferRecord;
    } catch (caught: any) {
      if (caught?.code === "ENOENT" || caught?.code === "ENOTDIR") return null;
      throw caught;
    }
  }

  async write(record: PreparedTransferRecord): Promise<void> {
    await FsFiles.writeAtomic(
      path.join(this.directory(record.id), PreparedTransferStore.RecordName),
      `${JSON.stringify(record, null, 2)}\n`
    );
  }

  /** Every record on disk. A folder whose record is gone is skipped. */
  async list(): Promise<PreparedTransferRecord[]> {
    const records: PreparedTransferRecord[] = [];
    for (const name of await FsFiles.readNames(this.root)) {
      const record = await this.read(name);
      if (record) records.push(record);
    }
    return records;
  }

  /** Moves a staged package into place as this transfer's `package/`. */
  async adopt(id: string, staged: string): Promise<void> {
    await fs.rename(staged, this.packageDirectory(id));
  }

  async writeIndex(id: string, entries: readonly PackagedEntry[]): Promise<void> {
    const text = entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
    await FsFiles.writeAtomic(path.join(this.directory(id), PreparedTransferStore.IndexName), text);
  }

  /** One page of the index, read a line at a time so a large package costs one page. */
  async page(id: string, offset: number, limit: number): Promise<PackagedEntry[]> {
    const file = Bun.file(path.join(this.directory(id), PreparedTransferStore.IndexName));
    if (!(await file.exists())) return [];
    const items: PackagedEntry[] = [];
    const decoder = new TextDecoder();
    let rest = "";
    let index = 0;
    for await (const chunk of file.stream()) {
      rest += decoder.decode(chunk, { stream: true });
      for (let newline = rest.indexOf("\n"); newline >= 0; newline = rest.indexOf("\n")) {
        if (index >= offset) items.push(JSON.parse(rest.slice(0, newline)) as PackagedEntry);
        rest = rest.slice(newline + 1);
        index++;
        if (items.length >= limit) return items;
      }
    }
    return items;
  }

  /** One entry of the verified package, by the source's address, or null. */
  async entry(record: PreparedTransferRecord, collection: string, id: string): Promise<Entry | null> {
    const { project, env } = record.from;
    const file = path.join(this.packageDirectory(record.id), "projects", project, env, "content", collection, `${id}.json`);
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as Entry;
    } catch (caught: any) {
      if (caught?.code === "ENOENT") return null;
      throw caught;
    }
  }

  /** Removes everything but the record: the package, its index, any half staged pull. */
  async drop(id: string): Promise<void> {
    for (const name of await FsFiles.readNames(this.directory(id))) {
      if (name === PreparedTransferStore.RecordName) continue;
      await Importer.discard(path.join(this.directory(id), name));
    }
  }

  /** Removes the transfer and everything it holds. */
  async remove(id: string): Promise<void> {
    await Importer.discard(this.directory(id));
  }
}
