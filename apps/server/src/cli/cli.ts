import { SiloVersion } from "../version";
import { CliOptions } from "./cli-options";
import { CommandRouter } from "./command-router";
import { UsageText } from "./usage-text";

/**
 * The CLI entrypoint: parse argv, answer the two questions that need nothing
 * else, and hand the rest to `CommandRouter`.
 */
export class Cli {
  static readonly version = SiloVersion;

  static async run(): Promise<void> {
    const argv = process.argv.slice(2);
    const { values, positionals } = CliOptions.parse(argv);
    const command = positionals[0];

    if (!command || command === "help" || values.help) {
      UsageText.print();
      // No command at all is a usage error; `help` is what was asked for.
      process.exit(command ? 0 : 2);
    }

    if (command === "version") {
      console.log("silo", Cli.version);
      process.exit(0);
    }

    await CommandRouter.dispatch({ argv, command, values, positionals, version: Cli.version });
  }
}
