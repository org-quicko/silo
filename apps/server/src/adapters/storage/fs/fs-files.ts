import fs from "fs/promises";
import path from "path";

/** The filesystem primitives every part of the fs adapter shares. */
export class FsFiles {
  /**
   * Writes through a temporary file in the same directory, fsyncs, then
   * renames. A reader — including an `rsync` or a `git add` running against a
   * live data dir — sees either the old file or the new one, never a torn one.
   *
   * The temporary name is a dotfile, so every listing here skips it.
   */
  static async writeAtomic(filePath: string, data: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const suffix = Math.random().toString(36).slice(2);
    const tempPath = path.join(dir, `.${path.basename(filePath)}-${suffix}.tmp`);
    try {
      const handle = await fs.open(tempPath, "w");
      await handle.writeFile(data, "utf8");
      await handle.sync();
      await handle.close();
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  static async exists(target: string): Promise<boolean> {
    try {
      await fs.stat(target);
      return true;
    } catch (error: any) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
      throw error;
    }
  }

  /**
   * Child directory names, sorted, with dotfiles excluded.
   *
   * `_`-prefixed directories are the reserved system scope and stay out of
   * every listing that answers "what scopes exist". `includeReserved` is for
   * the one caller that must see them anyway: the media usage scan, which asks
   * "does anything at all still reference this file" and would leave a silent
   * hole in the delete guard if it skipped a whole scope (D23).
   */
  static async readSubdirs(dir: string, includeReserved = false): Promise<string[]> {
    return (await FsFiles.readDirents(dir))
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          (includeReserved || !entry.name.startsWith("_"))
      )
      .map((entry) => entry.name)
      .sort();
  }

  /** Directory entries, or an empty list when the directory is absent. */
  static async readDirents(dir: string): Promise<import("fs").Dirent[]> {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch (error: any) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
      throw error;
    }
  }

  /** File names, or an empty list when the directory is absent. */
  static async readNames(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch (error: any) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
      throw error;
    }
  }

  /** Parsed JSON, or null when the file is absent, torn, or hand-edited. */
  static async readJsonOrNull(filePath: string): Promise<any | null> {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      return null;
    }
  }
}
