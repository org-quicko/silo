/** One member of an archive `ZipWriter` streams. */
export interface ZipEntry {
  /** Forward slashes, no leading slash. A directory ends in `/` and has no `open`. */
  path: string;
  modified: Date;
  /** Opened only when the writer reaches it. `null` means the bytes are gone. */
  open?: () => Promise<ReadableStream<Uint8Array> | null>;
}
