/**
 * Where an export walk puts what it produces.
 *
 * There is one walk and two destinations — a directory tree and a tar stream —
 * and they used to be one walk and one destination, with the tarball made by
 * staging the tree first and archiving it afterwards. That staging is what made
 * time-to-first-byte the length of the whole export (§7.1), so the walk now
 * writes through this instead and the tar sink forwards each entry as it
 * arrives.
 *
 * Every method is awaited, which is what carries a slow consumer's backpressure
 * back into the walk.
 */
export interface ExportSink {
  /** A file with the exact bytes given. */
  file(path: string, data: Uint8Array): Promise<void>;
  /** A UTF-8 text file — the JSON every non-media entry in an archive is. */
  text(path: string, text: string): Promise<void>;
  /**
   * A directory that must exist even when nothing is written inside it.
   *
   * Only the empty ones need saying: a scope that was created and holds nothing
   * is carried by its directory alone, and the file sinks create parents
   * themselves.
   */
  directory(path: string): Promise<void>;
}
