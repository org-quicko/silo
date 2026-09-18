import { TarHeader } from "./tar-header";

/**
 * A tar stream written one entry at a time.
 *
 * Every entry is handed straight to `sink`, so nothing larger than the entry
 * being written is ever held — and the first bytes leave before the walk that
 * produces the rest has finished. That is the whole point of it: staging an
 * archive in a temp tree first made time-to-first-byte the length of the entire
 * export (§7.1).
 *
 * `sink` is awaited, so a slow consumer slows the walk instead of queueing the
 * archive up behind it.
 */
export class TarWriter {
  private readonly sink: (chunk: Uint8Array) => Promise<void> | void;
  private readonly mtime: Date;
  private finished = false;

  /** `mtime` is stamped on every entry, so an unchanged instance exports
   *  identical bytes twice. */
  constructor(sink: (chunk: Uint8Array) => Promise<void> | void, mtime: Date) {
    this.sink = sink;
    this.mtime = mtime;
  }

  async addFile(entryPath: string, data: Uint8Array): Promise<void> {
    await this.writeEntry(entryPath, data.length, TarHeader.TypeFile, 0o644);
    await this.sink(data);
    const padding = TarHeader.padding(data.length);
    if (padding > 0) await this.sink(new Uint8Array(padding));
  }

  async addText(entryPath: string, text: string): Promise<void> {
    await this.addFile(entryPath, new TextEncoder().encode(text));
  }

  /** A trailing slash is added if the caller left it off; tar identifies a
   *  directory by both the type flag and the name. */
  async addDirectory(entryPath: string): Promise<void> {
    const normalized = entryPath.endsWith("/") ? entryPath : `${entryPath}/`;
    await this.writeEntry(normalized, 0, TarHeader.TypeDirectory, 0o755);
  }

  /** Two zero blocks, which is what marks the end of an archive. Idempotent,
   *  so an error path may call it without checking. */
  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    await this.sink(new Uint8Array(TarHeader.BlockSize * 2));
  }

  /**
   * The header, preceded by a PAX record when the path does not fit the ustar
   * `name` field. Splitting into `prefix` would cover some of those cases and
   * not the ones silo actually produces — a collection path is long in its
   * last segment — so there is one rule rather than two.
   */
  private async writeEntry(
    entryPath: string,
    size: number,
    type: string,
    mode: number
  ): Promise<void> {
    const encoded = new TextEncoder().encode(entryPath);
    if (encoded.length > TarHeader.MaxNameLength) {
      const record = TarHeader.extendedRecord("path", entryPath);
      await this.sink(
        TarHeader.build({
          path: "PaxHeader",
          size: record.length,
          type: TarHeader.TypeExtendedHeader,
          mode: 0o644,
          mtime: this.mtime,
        })
      );
      await this.sink(record);
      const padding = TarHeader.padding(record.length);
      if (padding > 0) await this.sink(new Uint8Array(padding));
    }

    await this.sink(
      TarHeader.build({ path: entryPath, size, type, mode, mtime: this.mtime })
    );
  }
}
