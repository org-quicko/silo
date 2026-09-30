import type { ZipEntry } from "./zip-entry";
import { ZipRecords } from "./zip-records";

export interface ZipWriterOptions {
  /** An entry describing the files that could not be read, appended last. */
  skippedNote?: (paths: string[]) => ZipEntry;
  /** Called once, when the stream finishes, fails or is cancelled. */
  onClose?: () => void;
}

interface Written {
  central: Uint8Array;
  length: number;
}

/**
 * Streams a STORE-only ZIP, pulling each file's bytes only as the reader asks
 * for them, so memory holds one chunk and the central directory. No ZIP64:
 * callers keep an archive under 4 GiB and 65,535 entries (D106).
 */
export class ZipWriter {
  private static readonly MaxOffset = 0xffffffff;
  private static readonly MaxEntries = 0xffff;
  private static readonly encoder = new TextEncoder();

  static stream(entries: Iterable<ZipEntry>, options: ZipWriterOptions = {}): ReadableStream<Uint8Array> {
    const chunks = ZipWriter.chunks(entries, options);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      options.onClose?.();
    };

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await chunks.next();
          if (next.done) {
            close();
            controller.close();
          } else {
            controller.enqueue(next.value);
          }
        } catch (caught) {
          close();
          controller.error(caught);
        }
      },
      async cancel() {
        close();
        await chunks.return(undefined);
      },
    });
  }

  private static async *chunks(entries: Iterable<ZipEntry>, options: ZipWriterOptions): AsyncGenerator<Uint8Array> {
    const central: Uint8Array[] = [];
    const skipped: string[] = [];
    let offset = 0;

    const append = (written: Written) => {
      central.push(written.central);
      offset += written.length;
      if (offset > ZipWriter.MaxOffset) throw new Error("zip archive passed 4 GiB");
      if (central.length > ZipWriter.MaxEntries) throw new Error("zip archive passed 65535 entries");
    };

    for (const entry of entries) {
      const written = entry.open ? yield* ZipWriter.file(entry, offset) : yield* ZipWriter.directory(entry, offset);
      if (written) append(written);
      else skipped.push(entry.path);
    }
    if (skipped.length > 0 && options.skippedNote) {
      const written = yield* ZipWriter.file(options.skippedNote(skipped), offset);
      if (written) append(written);
    }

    let centralSize = 0;
    for (const header of central) {
      centralSize += header.length;
      yield header;
    }
    yield ZipRecords.end(central.length, centralSize, offset);
  }

  private static async *directory(entry: ZipEntry, offset: number): AsyncGenerator<Uint8Array, Written> {
    const name = ZipWriter.encoder.encode(entry.path);
    const header = ZipRecords.localHeader(name, entry.modified, true);
    yield header;
    return {
      central: ZipRecords.centralHeader({ name, modified: entry.modified, directory: true, crc: 0, size: 0, offset }),
      length: header.length,
    };
  }

  /** `null` when the file cannot be opened or its first read fails: nothing is written for it. */
  private static async *file(entry: ZipEntry, offset: number): AsyncGenerator<Uint8Array, Written | null> {
    const body = await entry.open!().catch(() => null);
    if (!body) return null;
    const reader = body.getReader();
    let drained = false;
    // Every exit short of the last byte, a cancelled download included, releases the blob's handle.
    try {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch {
        return null;
      }

      const name = ZipWriter.encoder.encode(entry.path);
      const header = ZipRecords.localHeader(name, entry.modified, false);
      yield header;

      let crc = 0;
      let size = 0;
      while (!chunk.done) {
        crc = Bun.hash.crc32(chunk.value, crc) >>> 0;
        size += chunk.value.byteLength;
        if (offset + header.length + size > ZipWriter.MaxOffset) throw new Error("zip entry passed 4 GiB");
        yield chunk.value;
        chunk = await reader.read();
      }
      drained = true;

      const descriptor = ZipRecords.dataDescriptor(crc, size);
      yield descriptor;
      return {
        central: ZipRecords.centralHeader({ name, modified: entry.modified, directory: false, crc, size, offset }),
        length: header.length + size + descriptor.length,
      };
    } finally {
      if (!drained) await reader.cancel().catch(() => {});
    }
  }
}
