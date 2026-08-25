import type { LogConfig } from "../config/log-config";
import { ConsoleSink } from "./console-sink";
import { FileSink } from "./file-sink";
import type { LogLevel } from "./log-level";
import { LogLevels } from "./log-level";
import type { LogSink } from "./log-sink";

/**
 * The server's log: a level threshold, a format, and one or more destinations.
 *
 * Only the long-running server logs through this. CLI subcommands keep writing
 * to stdout with `console.log`, because `silo keys list` emits *program
 * output* — data a caller pipes into something else — and routing that into a
 * log file would take the answer away from the person who asked for it.
 *
 * Destination rule, stated once:
 *
 * - No `[log] file` — the console, always. `silo serve > out.txt` must keep
 *   working, so this does not depend on a TTY.
 * - A `[log] file` — that file, plus the console **only when stdout is a
 *   terminal**. Someone watching a foreground server should still see it come
 *   up; a detached run has nobody watching, so the file is the only copy and
 *   there is no double write.
 */
export class Logger {
  private readonly sinks: LogSink[];
  private readonly threshold: number;
  private readonly json: boolean;
  private readonly interactive: boolean;
  readonly file?: string;

  private constructor(sinks: LogSink[], threshold: number, json: boolean, interactive: boolean, file?: string) {
    this.sinks = sinks;
    this.threshold = threshold;
    this.json = json;
    this.interactive = interactive;
    this.file = file;
  }

  static create(config: LogConfig, file?: string): Logger {
    const target = file ?? config.file;
    const sinks: LogSink[] = [];
    if (target) {
      sinks.push(FileSink.open(target, config.max_size_mb, config.max_files));
      if (process.stdout.isTTY) sinks.push(new ConsoleSink());
    } else {
      sinks.push(new ConsoleSink());
    }
    return new Logger(
      sinks,
      LogLevels.threshold(config.level),
      config.format === "json",
      !target && process.stdout.isTTY === true,
      target
    );
  }

  /** A logger that drops everything — the default for tests and for embedders
   *  that only want the Hono app. */
  static silent(): Logger {
    return new Logger([], Number.POSITIVE_INFINITY, false, false, undefined);
  }

  /**
   * Whether output is going to a terminal and nowhere else. The one caller is
   * the bootstrap banner: escape codes are right for a person watching and
   * wrong for a file, and when a file is in play the plain rendering is the
   * only one that suits every destination.
   */
  isInteractive(): boolean {
    return this.interactive;
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.emit("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.emit("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.emit("warn", message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.emit("error", message, fields);
  }

  /** Writes a pre-rendered block (the bootstrap banner) verbatim, past the
   *  level threshold — a credential shown exactly once is not a log line and
   *  must not be filtered away by `[log] level`. */
  raw(text: string): void {
    for (const sink of this.sinks) sink.writeRaw(text);
  }

  private emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LogLevels.rank(level) < this.threshold) return;
    const line = this.json ? Logger.jsonLine(level, message, fields) : Logger.textLine(level, message, fields);
    for (const sink of this.sinks) sink.write(line, level);
  }

  private static jsonLine(level: LogLevel, message: string, fields?: Record<string, unknown>): string {
    return JSON.stringify({ ts: new Date().toISOString(), level, msg: message, ...(fields ?? {}) });
  }

  private static textLine(level: LogLevel, message: string, fields?: Record<string, unknown>): string {
    const tail = fields
      ? Object.entries(fields)
          .map(([key, value]) => ` ${key}=${Logger.textValue(value)}`)
          .join("")
      : "";
    return `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${tail}`;
  }

  /** Quotes only what would otherwise break `key=value` scanning, so the common
   *  case stays readable and a value with a space stays one field. */
  private static textValue(value: unknown): string {
    const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
    return /[\s"]/.test(text) ? JSON.stringify(text) : text;
  }

  async close(): Promise<void> {
    for (const sink of this.sinks) await sink.close();
  }
}
