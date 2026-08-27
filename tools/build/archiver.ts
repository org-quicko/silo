import fs from "fs/promises";
import path from "path";
import { create as createTar } from "tar";
import type { BuildTarget } from "./build-target";
import { BuildPaths } from "./build-paths";

/**
 * Stages the executable next to the licence and README, and tars the three.
 *
 * Staging rather than tarring in place keeps the archive's internal layout
 * independent of where the build happened to write: the tarball holds `silo`,
 * never `dist/linux-x64/silo`, which is what Homebrew's `bin.install "silo"`
 * expects. `portable` drops the uid, gid and user names of whichever runner
 * produced it, leaving an archive that is a function of its contents.
 */
export class Archiver {
  static async archive(
    outfile: string,
    target: BuildTarget,
    version: string
  ): Promise<string> {
    const name = `silo-${version}-${target.os}-${target.arch}`;
    const stage = path.join(BuildPaths.DistDir, `stage-${target.os}-${target.arch}`);
    const binaryName = `silo${target.exe}`;

    await fs.rm(stage, { recursive: true, force: true });
    await fs.mkdir(stage, { recursive: true });

    await fs.copyFile(outfile, path.join(stage, binaryName));
    await fs.chmod(path.join(stage, binaryName), 0o755);
    for (const extra of BuildPaths.ArchiveExtras) {
      await fs.copyFile(extra, path.join(stage, extra));
    }

    const archive = path.join(BuildPaths.DistDir, `${name}.tar.gz`);
    await createTar({ file: archive, cwd: stage, gzip: true, portable: true }, [
      binaryName,
      ...BuildPaths.ArchiveExtras,
    ]);

    await fs.rm(stage, { recursive: true, force: true });
    return archive;
  }
}
