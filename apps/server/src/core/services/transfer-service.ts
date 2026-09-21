import type { Scope } from "../domain/scope";
import type { ExportManifest } from "../transfer/export-manifest";
import type { ExportOptions } from "../transfer/export-options";
import { Exporter } from "../transfer/exporter";
import type { ImportOptions } from "../transfer/import-options";
import type { ImportResult } from "../transfer/import-result";
import { Importer } from "../transfer/importer";
import type { ScopeCopyOptions } from "../transfer/scope-copy-options";
import { ScopeCopier } from "../transfer/scope-copier";
import type { ServiceContext } from "./support/service-context";

/**
 * Export, import, and server-to-server copy.
 *
 * The archive routines are instance-wide: every scope, including `_system` per
 * `--with-keys`, moves in one pass. They write through `Storage.put` directly
 * and dispatch **no** hooks, because an import is meant to reproduce an archive
 * faithfully (D31/§13.5).
 */
export class TransferService {
  private readonly context: ServiceContext;

  constructor(context: ServiceContext) {
    this.context = context;
  }

  /** Answers the manifest it wrote, so a caller can report what actually rode. */
  async exportDir(destination: string, options: ExportOptions): Promise<ExportManifest> {
    return Exporter.exportDir(
      this.context.store,
      destination,
      options,
      this.context.blobStorage
    );
  }

  async exportTarGz(
    writer: WritableStreamDefaultWriter<any> | any,
    options: ExportOptions
  ): Promise<void> {
    await Exporter.exportTarGz(this.context.store, writer, options, this.context.blobStorage);
  }

  /**
   * The archive as a stream, produced as it is walked — the first bytes are
   * available immediately and nothing larger than one entry is ever held.
   *
   * Not async, and that is the point: there is no walk to await before the
   * response can begin.
   */
  exportTarGzStream(options: ExportOptions): ReadableStream<Uint8Array> {
    return Exporter.exportTarGzStream(this.context.store, options, this.context.blobStorage);
  }

  async importDir(source: string, options: ImportOptions): Promise<ImportResult> {
    return this.context.withWriteLock(async () => {
      const result = await Importer.importDir(
        this.context.store,
        source,
        options,
        this.context.blobStorage
      );
      this.context.schemaRegistry.invalidate();
      return result;
    });
  }

  /**
   * An archive from a path or a `Buffer`. The parameter used to say
   * `ReadableStream | any` and a stream was the one thing it could not take —
   * `importTarGzStream` below is that case.
   */
  async importTarGz(
    source: string | Buffer,
    options: ImportOptions
  ): Promise<ImportResult> {
    return this.context.withWriteLock(async () => {
      const result = await Importer.importTarGz(
        this.context.store,
        source,
        options,
        this.context.blobStorage
      );
      this.context.schemaRegistry.invalidate();
      return result;
    });
  }

  /**
   * An archive that arrives as a stream — an upload body, or another
   * instance's export. Nothing is buffered whole, so peak memory does not
   * scale with the source's media library. The write lock is held for the
   * whole transfer, extraction included, exactly as the buffered path held it.
   */
  async importTarGzStream(
    archive: ReadableStream<Uint8Array>,
    options: ImportOptions
  ): Promise<ImportResult> {
    return this.context.withWriteLock(async () => {
      const result = await Importer.importTarGzStream(
        this.context.store,
        archive,
        { stagingDirectory: this.context.stagingDirectory, ...options },
        this.context.blobStorage
      );
      this.context.schemaRegistry.invalidate();
      return result;
    });
  }

  /**
   * Copies one scope's schemas and entries onto another of this instance
   * (D22). Scoped, unlike the archive routines above; media is instance-global
   * and therefore not part of it.
   */
  async copyScope(from: Scope, to: Scope, options: ScopeCopyOptions): Promise<ImportResult> {
    return this.context.withWriteLock(async () => {
      const result = await ScopeCopier.copy(this.context.store, from, to, options);
      this.context.schemaRegistry.invalidate();
      return result;
    });
  }
}
