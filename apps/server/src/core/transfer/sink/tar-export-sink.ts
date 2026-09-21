import type { ExportSink } from "./export-sink";
import type { TarWriter } from "../tar/tar-writer";

/**
 * An export written straight into a tar stream, entry by entry.
 *
 * Nothing is staged and nothing is held: each file reaches the consumer as the
 * walk produces it, so peak memory is one entry and the first byte leaves
 * before the second entry is read.
 */
export class TarExportSink implements ExportSink {
  private readonly writer: TarWriter;

  constructor(writer: TarWriter) {
    this.writer = writer;
  }

  async file(entryPath: string, data: Uint8Array): Promise<void> {
    await this.writer.addFile(entryPath, data);
  }

  async text(entryPath: string, text: string): Promise<void> {
    await this.writer.addText(entryPath, text);
  }

  async directory(entryPath: string): Promise<void> {
    await this.writer.addDirectory(entryPath);
  }
}
