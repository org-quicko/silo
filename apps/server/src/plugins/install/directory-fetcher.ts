import fs from "fs/promises";
import path from "path";
import { PackageExtractor } from "./package-extractor";
import type { FetchedPackage, PackageFetcher } from "./package-fetcher";

/**
 * `silo add ./my-plugin` — a directory the operator already has (D32).
 *
 * Copied, never symlinked. A symlinked plugin would make `<data dir>/plugins/`
 * stop being self-contained, and D5's whole thesis is that an instance is a
 * directory you can `cp` — an instance whose extensions live elsewhere on the
 * developer's laptop does not travel, and would then fail on the machine it
 * was copied to rather than on the one where the mistake was made.
 *
 * Symlinks *inside* the tree are dropped for the same reason, and every path
 * is held to the same segment rule an archive is: this source is trusted more
 * than a download, but an installed plugin directory should mean the same
 * thing however it got there.
 */
export class DirectoryFetcher implements PackageFetcher {
  constructor(private readonly source: string) {}

  async fetch(staging: string): Promise<FetchedPackage> {
    const from = path.resolve(this.source);
    const what = `plugin at "${from}"`;

    let stat;
    try {
      stat = await fs.stat(from);
    } catch {
      throw new Error(`${what}: no such directory`);
    }
    if (!stat.isDirectory()) throw new Error(`${what}: not a directory`);

    const into = path.join(staging, "package");
    await fs.cp(from, into, {
      recursive: true,
      // Skipping a symlink needs it to still *be* one when the filter runs.
      dereference: false,
      // Dropping an entry silently is right here and would be wrong for an
      // archive: this is a tree the operator can see and fix, and a stray
      // socket file or a build symlink in it is a mess, not an attack.
      filter: (src) => DirectoryFetcher.keep(from, src),
    });

    return { dir: await PackageExtractor.packageRoot(into, what), resolved: from };
  }

  private static async keep(root: string, src: string): Promise<boolean> {
    const relative = path.relative(root, src);
    if (relative.length === 0) return true;

    // A copy of the source tree, not of the history that produced it.
    if (relative.split(path.sep).includes(".git")) return false;

    try {
      PackageExtractor.assertSafePath(relative, "directory");
      return !(await fs.lstat(src)).isSymbolicLink();
    } catch {
      return false;
    }
  }
}
