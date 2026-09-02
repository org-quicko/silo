import type { Scope } from "../domain/scope";
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

  async exportDir(destination: string, options: ExportOptions): Promise<void> {
    await Exporter.exportDir(
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
   * The archive as a stream, for a caller that can pass one straight to a
   * response body — nothing is buffered whole, so peak memory does not scale
   * with the media library.
   */
  async exportTarGzStream(options: ExportOptions): Promise<ReadableStream<Uint8Array>> {
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

  async importTarGz(
    reader: ReadableStream | any,
    options: ImportOptions
  ): Promise<ImportResult> {
    return this.context.withWriteLock(async () => {
      const result = await Importer.importTarGz(
        this.context.store,
        reader,
        options,
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
