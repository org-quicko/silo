import type { LogLevel } from "./log-level";
import type { LogSink } from "./log-sink";

/**
 * The default destination: the process's own streams.
 *
 * Warnings and errors go to stderr so that `silo serve > app.log` still shows
 * problems on the terminal, and a supervisor that separates the two streams
 * sees them separated. Written through `process.stdout.write` rather than
 * `console.log` because the lines are already terminated and already
 * formatted — `console.error` would additionally tint the whole line red on a
 * TTY, underneath any colour the payload carries.
 */
export class ConsoleSink implements LogSink {
  write(line: string, level: LogLevel): void {
    const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
    stream.write(line + "\n");
  }

  writeRaw(text: string): void {
    process.stderr.write(text);
  }

  async close(): Promise<void> {
    // Nothing to release: the streams outlive the sink.
  }
}
