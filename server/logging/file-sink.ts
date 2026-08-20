import fs from "fs";
import path from "path";
import type { LogSink } from "./log-sink";

/**
 * Appends log lines to a file, rotating it by size.
 *
 * Rotation exists because this sink's whole reason to exist is a process that
 * runs for months unattended; an unbounded log file is not a tidiness problem
 * there, it is the thing that fills the disk the database is on.
 *
 * Writes are **synchronous**. Buffering would be faster, but a crash is
 * precisely when the last few lines matter most, and silo's log volume is a
 * line per request on a CMS — the same trade the fs storage adapter already
 * makes in favour of being obviously correct over being fast.
 */
export class FileSink implements LogSink {
  private fd: number;
  private size: number;
  private readonly file: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;

  private constructor(file: string, fd: number, size: number, maxBytes: number, maxFiles: number) {
    this.file = file;
    this.fd = fd;
    this.size = size;
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
  }

  /** Opens (creating parents) in append mode. Throws if the path is unusable —
   *  a log destination that silently does not exist is worse than not booting. */
  static open(file: string, maxSizeMb: number, maxFiles: number): FileSink {
    const dir = path.dirname(file);
    if (dir && dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fd = fs.openSync(file, "a");
    let size = 0;
    try {
      size = fs.fstatSync(fd).size;
    } catch {
      size = 0;
    }
    const maxBytes = maxSizeMb > 0 ? Math.floor(maxSizeMb * 1024 * 1024) : 0;
    return new FileSink(file, fd, size, maxBytes, Math.max(0, Math.floor(maxFiles)));
  }

  write(line: string): void {
    this.append(line + "\n");
  }

  writeRaw(text: string): void {
    this.append(text);
  }

  private append(text: string): void {
    const bytes = Buffer.byteLength(text);
    if (this.maxBytes > 0 && this.size + bytes > this.maxBytes && this.size > 0) {
      this.rotate();
    }
    fs.writeSync(this.fd, text);
    this.size += bytes;
  }

  /**
   * Shifts `silo.log.<n-1>` up to `silo.log.<n>`, moves the live file to `.1`,
   * and reopens. Failures are swallowed: losing rotation costs disk space,
   * while throwing here would take the server down over housekeeping.
   */
  private rotate(): void {
    try {
      fs.closeSync(this.fd);
      if (this.maxFiles > 0) {
        // Downwards, so each file moves into a slot already vacated. The
        // last rename lands on `.<maxFiles>` and overwrites it, which is how
        // the oldest generation is dropped.
        for (let i = this.maxFiles - 1; i >= 1; i--) {
          const from = `${this.file}.${i}`;
          if (fs.existsSync(from)) fs.renameSync(from, `${this.file}.${i + 1}`);
        }
        fs.renameSync(this.file, `${this.file}.1`);
      } else {
        fs.rmSync(this.file, { force: true });
      }
    } catch {
      // Fall through to reopening whatever is there now.
    }
    this.fd = fs.openSync(this.file, "a");
    try {
      this.size = fs.fstatSync(this.fd).size;
    } catch {
      this.size = 0;
    }
  }

  async close(): Promise<void> {
    try {
      fs.closeSync(this.fd);
    } catch {
      // Already closed, or the descriptor went away with the process.
    }
  }
}
