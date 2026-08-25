import fs from "fs";

/** Reading the end of a log file, for `silo logs` and for reporting why a
 *  detached start died before it could serve anything. */
export class LogTail {
  /**
   * The last `count` lines.
   *
   * Reads only the tail of the file rather than all of it: a rotated log is
   * still tens of megabytes, and `silo logs -n 20` should not depend on how
   * long the server has been up.
   */
  static read(file: string, count: number): string[] {
    let fd: number;
    try {
      fd = fs.openSync(file, "r");
    } catch {
      return [];
    }
    try {
      const size = fs.fstatSync(fd).size;
      // Generous per line, capped: enough that `count` lines are almost always
      // in the window, bounded so a single pathological line cannot pull the
      // whole file into memory.
      const window = Math.min(size, Math.max(64 * 1024, count * 1024));
      const buffer = Buffer.alloc(window);
      fs.readSync(fd, buffer, 0, window, size - window);
      const lines = buffer.toString("utf8").split("\n");
      // The first line is probably a fragment of the line the window cut.
      if (window < size && lines.length > 1) lines.shift();
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      return lines.slice(-count);
    } catch {
      return [];
    } finally {
      fs.closeSync(fd);
    }
  }

  /** The file's current size, or 0 if it is not there — the starting offset
   *  for a follow. */
  static size(file: string): number {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  }

  /** Whatever was appended past `offset`, and the new offset. A file that
   *  shrank was rotated underneath us, so reading restarts from its head. */
  static since(file: string, offset: number): { text: string; offset: number } {
    let fd: number;
    try {
      fd = fs.openSync(file, "r");
    } catch {
      return { text: "", offset };
    }
    try {
      const size = fs.fstatSync(fd).size;
      const from = size < offset ? 0 : offset;
      if (size === from) return { text: "", offset: size };
      const buffer = Buffer.alloc(size - from);
      fs.readSync(fd, buffer, 0, buffer.length, from);
      return { text: buffer.toString("utf8"), offset: size };
    } catch {
      return { text: "", offset };
    } finally {
      fs.closeSync(fd);
    }
  }
}
