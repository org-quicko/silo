import type { BlobStorage } from "../ports/blob-storage";
import { FsBlobStorage } from "../../adapters/blob/fs-blob-storage";
import { EntryUtils } from "../domain/entry-utils";
import type { Storage } from "../ports/storage";
import { SiloVersion } from "../../version";
import { ExportMedia } from "./export-media";
import type { ExportManifest } from "./export-manifest";
import type { ExportOptions } from "./export-options";
import { ExportSystem } from "./export-system";
import { ExportWalk } from "./export-walk";
import { FormatVersion } from "./format-version";
import { MediaModes } from "./media-mode";
import { DirectoryExportSink } from "./sink/directory-export-sink";
import type { ExportSink } from "./sink/export-sink";
import { TarExportSink } from "./sink/tar-export-sink";
import { TarWriter } from "./tar/tar-writer";
import { TransferSelection } from "./transfer-selection";

/**
 * Turns an instance — or the part of one a selection names — into the §6.3
 * tree, through an `ExportSink`.
 *
 * The walk order is fixed and it is load-bearing: projects, then content
 * scopes, then `_system`, then media bytes, then `manifest.json`. `_system`
 * follows the content because its media filter needs every reference the
 * content holds, and the manifest is last because every number in it counts
 * what was actually written rather than what was expected to be.
 */
export class Exporter {
  /** The walk, against any sink. Answers the manifest it wrote. */
  static async export(
    store: Storage,
    sink: ExportSink,
    options: ExportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<ExportManifest> {
    const meta = await store.meta();
    const selection = options.include ?? TransferSelection.Everything;
    const media = options.media ?? MediaModes.default(!selection.isEverything);

    const walk = new ExportWalk(store, sink, selection);
    await walk.writeProjects();
    await walk.writeScopes();

    const system = new ExportSystem({
      store,
      sink,
      media,
      withKeys: options.withKeys === true,
      projectIds: walk.projectIds,
      referenced: walk.referenced,
    });
    await system.write();

    const files = blobStorage
      ? await ExportMedia.write({
          sink,
          blobStorage: Exporter.blobs(blobStorage),
          mode: media,
          blobKeys: system.blobKeys,
        })
      : 0;

    const manifest: ExportManifest = {
      format_version: FormatVersion,
      instance_id: meta.instance_id,
      last_seq: meta.last_seq,
      exported_at: (options.exportedAt || EntryUtils.now()).toISOString(),
      silo_version: options.siloVersion || SiloVersion,
      collections: { ...walk.counts, ...system.counts },
      ...(selection.isEverything ? {} : { selection: selection.describe() }),
      media: {
        mode: media,
        referenced: system.referencedAssets,
        catalogued: system.blobKeys.length,
        files,
      },
    };
    await sink.text("manifest.json", JSON.stringify(manifest, null, 2));
    return manifest;
  }

  /** The §6.3 tree on disk — `silo export --dir`. */
  static async exportDir(
    store: Storage,
    destination: string,
    options: ExportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<ExportManifest> {
    const sink = new DirectoryExportSink(destination);
    await sink.directory("");
    return Exporter.export(store, sink, options, blobStorage);
  }

  /**
   * The archive as a gzipped tar stream, produced as it is walked.
   *
   * Nothing is staged: the first bytes leave before the second entry is read,
   * which is what keeps the response alive on a connection that closes when it
   * goes quiet, and what keeps peak memory at one entry rather than one media
   * library.
   *
   * The cost is stated rather than hidden. A storage or blob failure now
   * arrives **after** the response has begun, so it truncates the body instead
   * of becoming an error status. A truncated archive fails its own gzip check
   * at the far end and extracts nothing, so it cannot half-import — §7.1.
   */
  static exportTarGzStream(
    store: Storage,
    options: ExportOptions,
    blobStorage?: BlobStorage | string
  ): ReadableStream<Uint8Array> {
    const exportedAt = options.exportedAt || EntryUtils.now();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    // `writer.write` resolves only when the chunk is taken, so awaiting it is
    // what carries the consumer's backpressure back into the walk.
    const tar = new TarWriter((chunk) => writer.write(chunk), exportedAt);

    void (async () => {
      try {
        await Exporter.export(store, new TarExportSink(tar), { ...options, exportedAt }, blobStorage);
        await tar.finish();
        await writer.close();
      } catch (caught) {
        // Aborting errors the readable, so a consumer sees the failure rather
        // than a stream that simply stops.
        await writer.abort(caught).catch(() => {});
      }
    })();

    return readable.pipeThrough(new CompressionStream("gzip"));
  }

  /**
   * The tarball to a file path or to any writer.
   *
   * The writer is written to and not closed; whoever opened it owns closing it.
   */
  static async exportTarGz(
    store: Storage,
    destination: string | { write(chunk: Uint8Array): unknown },
    options: ExportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<void> {
    // Checked before the walk starts, so an unusable destination costs no
    // storage reads and leaves no stream nobody will drain.
    if (typeof destination !== "string" && typeof destination?.write !== "function") {
      throw new Error("unsupported writer type");
    }

    // A path gets an incremental file sink rather than `Bun.write(path,
    // Response)`: that overload does not drain a streaming body, so it waits
    // on a producer that is waiting on it.
    const file = typeof destination === "string" ? Bun.file(destination).writer() : null;
    const sink = file ?? (destination as { write(chunk: Uint8Array): unknown });

    const reader = Exporter.exportTarGzStream(store, options, blobStorage).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await sink.write(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      // Closes the handle on the failing path too; `end` twice is harmless.
      file?.end();
    }
  }

  private static blobs(blobStorage: BlobStorage | string): BlobStorage {
    return typeof blobStorage === "string" ? new FsBlobStorage(blobStorage) : blobStorage;
  }
}
