import type { LogLevel } from "./log-level";

/**
 * Somewhere a formatted log line can go.
 *
 * `write` is synchronous and takes the already-formatted line. The level comes
 * along because a destination may route by it — the console splits warn/error
 * onto stderr — while a file does not care.
 */
export interface LogSink {
  write(line: string, level: LogLevel): void;
  /** Writes a pre-formatted block verbatim: no timestamp, no level prefix. */
  writeRaw(text: string): void;
  close(): Promise<void>;
}
