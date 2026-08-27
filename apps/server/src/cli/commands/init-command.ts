import fs from "fs/promises";
import { ConfigScaffold } from "../../config/config-scaffold";

/**
 * `silo init` — scaffolds a `silo.toml` holding silo's default settings.
 *
 * The file itself is `ConfigScaffold`'s, because an install with no config file
 * to list a plugin in writes the same one (§13.21). What is `init`'s alone is
 * the refusal: a file that already exists is somebody's settings, and only
 * `--force` overwrites it.
 *
 * Runs before any storage is opened — writing a config file must not create a
 * data dir as a side effect, and `--config` naming a file that does not exist
 * yet is the normal case rather than an error.
 */
export class InitCommand {
  static async run(configPath: string, force: boolean): Promise<void> {
    if (!force && (await InitCommand.exists(configPath))) {
      throw new Error(`${configPath} already exists — pass --force to overwrite it`);
    }

    await ConfigScaffold.write(configPath);
    console.log(`wrote default config: ${configPath}`);
  }

  private static async exists(file: string): Promise<boolean> {
    try {
      await fs.stat(file);
      return true;
    } catch {
      return false;
    }
  }
}
