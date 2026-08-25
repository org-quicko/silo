import fs from "fs";
import type { Config } from "../../config/config";
import { LogLocation } from "../../logging/log-location";
import { LogTail } from "../../logging/log-tail";
import { RunFile } from "../../runtime/run-file";

/**
 * `silo logs` — the end of the log file, optionally followed.
 *
 * Exists so that "where did my logs go" has an answer that does not require
 * knowing the path. A server logging to the console has no file to read, and
 * saying so plainly is more useful than printing nothing.
 */
export class LogsCommand {
  private static readonly PollMs = 300;

  static async run(config: Config, lines: number, follow: boolean): Promise<void> {
    const file = LogLocation.forReading(config, await RunFile.read(config.storage.path));

    if (!file) {
      console.error(
        `silo: this server writes to the console, not to a file. ` +
          `Set "[log] file" (or SILO_LOG_FILE), or start it with "silo serve --detach".`
      );
      process.exit(1);
    }

    if (!fs.existsSync(file)) {
      console.error(`silo: no log file at ${file}`);
      process.exit(1);
    }

    for (const line of LogTail.read(file, lines)) {
      console.log(line);
    }

    if (!follow) return;

    // Polled rather than watched: the file may be rotated out from under us,
    // and a size that went backwards is the signal to start again from its
    // head — which a watcher on the old inode would never see.
    let offset = LogTail.size(file);
    for (;;) {
      await Bun.sleep(LogsCommand.PollMs);
      const { text, offset: next } = LogTail.since(file, offset);
      offset = next;
      if (text) process.stdout.write(text);
    }
  }
}
