import fs from "fs/promises";

/**
 * A file, or a span of it, read from disk one fixed chunk at a time as the
 * consumer pulls (D80).
 *
 * Written by hand rather than taken from the runtime because the runtime's own
 * were measured and found wanting on Bun 1.3.14: a `Response` over a file
 * handle read the file whole per request, the handle's `.stream()` grew the
 * process by hundreds of megabytes under concurrent downloads, and a sliced
 * handle's stream returned nearly the whole file for a 1,000-byte range. This
 * one grew the process by 24 MB for six concurrent 60 MB downloads and slices
 * exactly. The handle is opened on the first pull and closed on the last, or
 * on cancel, so a client that leaves mid-body leaves no descriptor behind.
 */
export class FileByteStream {
  static readonly ChunkBytes = 64 * 1024;

  /** Bytes `start` through `end` inclusive; an empty span closes at once. */
  static open(filePath: string, start: number, end: number): ReadableStream<Uint8Array> {
    let handle: fs.FileHandle | null = null;
    let position = start;

    const release = async () => {
      const open = handle;
      handle = null;
      if (open) await open.close().catch(() => {});
    };

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const remaining = end - position + 1;
          if (remaining <= 0) {
            await release();
            controller.close();
            return;
          }
          handle ??= await fs.open(filePath, "r");
          const buffer = new Uint8Array(Math.min(FileByteStream.ChunkBytes, remaining));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          if (bytesRead === 0) {
            // Shorter than the span asked for: the file changed under us.
            // Ending here is the honest answer; the span was true at `stat`.
            await release();
            controller.close();
            return;
          }
          position += bytesRead;
          controller.enqueue(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
        } catch (caught) {
          await release();
          controller.error(caught);
        }
      },
      cancel: release,
    });
  }
}
