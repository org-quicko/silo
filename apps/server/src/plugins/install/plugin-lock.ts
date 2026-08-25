import fs from "fs/promises";
import path from "path";
import type { PluginSource } from "./plugin-source";

export interface LockEntry {
  /** Which `PluginSource` kind produced it. */
  source: PluginSource["kind"];

  /** The spec exactly as typed, so `silo add` can be replayed rather than
   *  reconstructed. */
  spec: string;

  /** What the spec resolved to: an npm version, a commit sha, a URL, a path. */
  resolved: string;

  /** The digest the bytes were checked against, where there was one. */
  integrity?: string;

  installed_at: string;
}

/**
 * `<data dir>/plugins/silo-plugins.lock.json` — what is installed, and what it
 * was when it was installed (D32).
 *
 * **A record, not a resolver**: nothing reads it at startup, `serve` still
 * loads exactly what `silo.toml` names, and deleting it breaks nothing. A
 * lockfile that gated loading would put a second source of truth beside the
 * config file, which D31 made the whole management surface.
 *
 * What it buys is the question a `[[plugins]]` entry cannot answer six months
 * later: which version is in this directory, where it came from, and whether
 * the bytes are the ones that were published. It lives in the plugins
 * directory because it describes that directory's contents, and D5 says an
 * instance is a thing you can `cp`.
 */
export class PluginLock {
  static readonly FileName = "silo-plugins.lock.json";

  /** Bumped only if the shape changes in a way an older silo would misread.
   *  An unknown version is refused rather than guessed at, as D14 does for an
   *  archive's `format_version`. */
  static readonly Version = 1;

  private constructor(
    private readonly file: string,
    private readonly entries: Record<string, LockEntry>
  ) {}

  static async open(pluginsDir: string): Promise<PluginLock> {
    const file = path.join(pluginsDir, PluginLock.FileName);

    let parsed: any;
    try {
      parsed = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      // Absent or unreadable is the normal case on a first install, and an
      // unreadable one is not worth refusing over: it is a record of the past,
      // and the directory beside it is the truth.
      return new PluginLock(file, {});
    }

    if (parsed?.lockfile_version !== PluginLock.Version) {
      throw new Error(
        `${file}: lockfile_version ${parsed?.lockfile_version} is not ${PluginLock.Version}. ` +
          `This file was written by a different silo — move it aside to continue.`
      );
    }
    return new PluginLock(file, parsed.plugins ?? {});
  }

  get(name: string): LockEntry | undefined {
    return this.entries[name];
  }

  async record(name: string, entry: LockEntry): Promise<void> {
    this.entries[name] = entry;
    await this.write();
  }

  async forget(name: string): Promise<void> {
    delete this.entries[name];
    await this.write();
  }

  private async write(): Promise<void> {
    // Sorted, so the file is stable under version control — an instance
    // directory is something people commit, per D5.
    const plugins: Record<string, LockEntry> = {};
    for (const name of Object.keys(this.entries).sort()) plugins[name] = this.entries[name]!;

    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(
      this.file,
      `${JSON.stringify({ lockfile_version: PluginLock.Version, plugins }, null, 2)}\n`,
      "utf8"
    );
  }
}
