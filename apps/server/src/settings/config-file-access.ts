import fs from "fs/promises";
import path from "path";
import { ValidationError } from "@silo/shared/validation-error";

/** Whether a settings save can land, and the one sentence the admin shows when
 *  it cannot. */
export interface ConfigFileAccessReport {
  writable: boolean;
  read_only_reason?: string;
}

/**
 * Whether the settings APIs can write `silo.toml`, and what to say when they
 * cannot (D50).
 *
 * The three supervisors answered "writable?" with "was I handed a path?", which
 * is only half the question. A container runs from an image directory its own
 * user may not write to, so the answer was yes, the admin offered the form, and
 * the save died as a `500 internal error` with the real reason visible only in
 * the server log. Both halves are answered here instead: the path is probed for
 * the view, and a filesystem that refuses the write is reported as the operator
 * condition it is rather than as a fault.
 *
 * The probe is advisory and {@link writing} is not. A path that passes can still
 * fail — permissions change, volumes fill — so the write stays wrapped, and the
 * probe exists only so the page can say up front what the save would say.
 */
export class ConfigFileAccess {
  /** What a filesystem refusal means, in the words the operator has to act on.
   *  Anything not listed here is a fault rather than a condition, and is left
   *  alone so it keeps its stack and its 500. */
  private static readonly Refusals: Record<string, string> = {
    EACCES: "permission denied",
    EPERM: "permission denied",
    EROFS: "the filesystem is read-only",
    ENOSPC: "the disk is full",
    ENOTDIR: "part of the path is not a directory",
    EISDIR: "the path is a directory",
    ELOOP: "the path is a loop of symlinks",
    ENOENT: "the directory it would go in does not exist",
  };

  private static readonly Remedy =
    `Point --config or SILO_CONFIG at a path this server can write, ` +
    `or set the matching SILO_* variables instead.`;

  /** What the view reports about the file. `reloadable` is the supervisor's
   *  other half of the question: a process that cannot re-read the file cannot
   *  apply what it wrote, so it does not write. */
  static async report(
    configPath: string | undefined,
    reloadable: boolean
  ): Promise<ConfigFileAccessReport> {
    if (!configPath || !reloadable) {
      return {
        writable: false,
        read_only_reason:
          `This server was started without a config file, so there is nothing to write to. ` +
          `Start it with --config or SILO_CONFIG, or set the matching SILO_* variables.`,
      };
    }

    if (await ConfigFileAccess.writable(configPath)) return { writable: true };

    return {
      writable: false,
      read_only_reason: `${configPath} is not writable by this server. ${ConfigFileAccess.Remedy}`,
    };
  }

  /**
   * Run one table write, putting the file back if it fails and reporting a
   * filesystem refusal as something the caller can act on.
   *
   * `restore` runs on any failure, because a write that got as far as creating
   * the file and no further would otherwise leave a scaffold behind that nobody
   * asked for — the same guarantee the reload step already gives.
   */
  static async writing<T>(
    configPath: string,
    restore: () => Promise<void>,
    write: () => Promise<T>
  ): Promise<T> {
    try {
      return await write();
    } catch (caught) {
      await restore();

      const refusal = ConfigFileAccess.Refusals[(caught as { code?: string }).code ?? ""];
      if (!refusal) throw caught;

      throw new ValidationError(
        `${configPath} could not be written: ${refusal}. ${ConfigFileAccess.Remedy}`
      );
    }
  }

  /** Whether a file can be written at this path: the file itself when it is
   *  there, and otherwise whether one could be created. */
  private static async writable(configPath: string): Promise<boolean> {
    try {
      await fs.access(configPath, fs.constants.W_OK);
      return true;
    } catch (caught) {
      if ((caught as { code?: string }).code !== "ENOENT") return false;
    }
    return ConfigFileAccess.creatable(configPath);
  }

  /**
   * Whether a file could be created at this path.
   *
   * The nearest directory that **exists** is the one asked, not the immediate
   * parent: `ConfigScaffold` creates the rest of the path, so reporting
   * `/data/etc/silo.toml` read-only because `etc/` is not there yet would be a
   * page refusing a save that would have worked.
   */
  private static async creatable(configPath: string): Promise<boolean> {
    let directory = path.dirname(path.resolve(configPath));

    for (;;) {
      try {
        await fs.access(directory, fs.constants.W_OK);
        return true;
      } catch (caught) {
        if ((caught as { code?: string }).code !== "ENOENT") return false;
        const parent = path.dirname(directory);
        if (parent === directory) return false;
        directory = parent;
      }
    }
  }
}
