import fs from "fs/promises";
import path from "path";
import type { ExportSink } from "./export-sink";

/** An export written as a directory tree — what `silo export --dir` produces. */
export class DirectoryExportSink implements ExportSink {
  private readonly root: string;
  /** Directories already made, so a collection of 4,000 entries costs one
   *  `mkdir` rather than 4,000. */
  private readonly made = new Set<string>();

  constructor(root: string) {
    this.root = root;
  }

  async file(entryPath: string, data: Uint8Array): Promise<void> {
    const destination = this.resolve(entryPath);
    await this.ensure(path.dirname(destination));
    await fs.writeFile(destination, data);
  }

  async text(entryPath: string, text: string): Promise<void> {
    const destination = this.resolve(entryPath);
    await this.ensure(path.dirname(destination));
    await fs.writeFile(destination, text, "utf8");
  }

  async directory(entryPath: string): Promise<void> {
    await this.ensure(this.resolve(entryPath));
  }

  private resolve(entryPath: string): string {
    return path.join(this.root, ...entryPath.split("/"));
  }

  private async ensure(directory: string): Promise<void> {
    if (this.made.has(directory)) return;
    await fs.mkdir(directory, { recursive: true });
    this.made.add(directory);
  }
}
