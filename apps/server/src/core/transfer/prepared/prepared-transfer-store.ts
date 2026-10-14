import fs from "fs/promises";
import path from "path";
import { FsFiles } from "../../../adapters/storage/fs/fs-files";
import { Importer } from "../importer";
import type { TransferPlanLine } from "../plan/transfer-plan-line";
import { PreparedTransferPackage } from "./prepared-transfer-package";
import type { PreparedTransferRecord } from "./prepared-transfer-record";

/**
 * The prepared transfers on this server's disk (D109): one folder each, named
 * by its id, holding `record.json`, the verified `package/`, and
 * `plan.ndjson`, the plan's lines that the review pages through (D110).
 *
 * Local disk is the right home because one process owns a data directory (D25,
 * D94). `record.json` is written through a synced temporary file and a rename,
 * so a restart never finds a torn one.
 */
export class PreparedTransferStore {
  static readonly RecordName = "record.json";
  static readonly PackageName = "package";
  static readonly PlanName = "plan.ndjson";

  /** Plan lines written per call while the plan is saved. */
  private static readonly PlanBatch = 500;

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

  /** Saves the plan as the planner yields it, a batch of lines at a time. */
  async writePlan(id: string, lines: AsyncIterable<TransferPlanLine>): Promise<void> {
    const handle = await fs.open(path.join(this.directory(id), PreparedTransferStore.PlanName), "w");
    try {
      let batch: string[] = [];
      for await (const line of lines) {
        batch.push(`${JSON.stringify(line)}\n`);
        if (batch.length < PreparedTransferStore.PlanBatch) continue;
        await handle.write(batch.join(""));
        batch = [];
      }
      await handle.write(batch.join(""));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /** One page of the plan, read a line at a time so a large plan costs one page. */
  async page(id: string, offset: number, limit: number): Promise<TransferPlanLine[]> {
    const items: TransferPlanLine[] = [];
    let index = 0;
    for await (const line of this.lines(id)) {
      if (index++ < offset) continue;
      items.push(line);
      if (items.length >= limit) break;
    }
    return items;
  }

  /** Every line of the plan, in order; none when there is no plan. */
  async *lines(id: string): AsyncGenerator<TransferPlanLine> {
    const file = Bun.file(path.join(this.directory(id), PreparedTransferStore.PlanName));
    if (!(await file.exists())) return;
    const decoder = new TextDecoder();
    let rest = "";
    for await (const chunk of file.stream()) {
      rest += decoder.decode(chunk, { stream: true });
      for (let newline = rest.indexOf("\n"); newline >= 0; newline = rest.indexOf("\n")) {
        yield JSON.parse(rest.slice(0, newline)) as TransferPlanLine;
        rest = rest.slice(newline + 1);
      }
    }
  }

  /** The verified package of `record`. */
  package(record: PreparedTransferRecord): PreparedTransferPackage {
    return new PreparedTransferPackage(this.packageDirectory(record.id), record.from);
  }

  /** Removes everything but the record: the package, its plan, any half staged pull. */
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
