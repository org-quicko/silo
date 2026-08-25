#!/usr/bin/env bun
import fs from "fs/promises";
import path from "path";
import { parseArgs } from "util";
import { PackageVersion } from "../../apps/server/src/version";
import { Archiver } from "./archiver";

import type { BuildTarget } from "./build-target";
import { CodeSigner } from "./code-signer";
import { CommandRunner } from "./command-runner";
import { EntryGenerator } from "./entry-generator";
import { TargetTable } from "./target-table";

/**
 * Builds the `silo` executable: admin UI, embedded assets, compile, signature,
 * and optionally the release tarball.
 *
 * A script rather than a `package.json` one-liner because a release build is
 * four steps that have to happen in order and two of them are
 * platform-conditional. It is the single build path — `bun run build` and the
 * release workflow run this same file, differing only in flags — so a release
 * cannot be produced by a recipe nobody exercises locally.
 *
 *   bun run build                                   host, unstamped, for development
 *   bun run build -- --target linux-x64 \
 *     --version 1.2.3 --archive                     one release artifact
 *
 * Flags:
 *   --target <name>   host (default) | darwin-arm64 | darwin-x64 | linux-x64 |
 *                     linux-arm64 | windows-x64
 *   --version <v>     stamped into the binary; defaults to the dev version
 *   --out <path>      where to write the executable
 *   --archive         also write dist/silo-<version>-<os>-<arch>.tar.gz
 *   --skip-ui         don't rebuild the admin UI; apps/admin/dist must exist
 */
export class BuildBinary {
  /** Anything that is not a release says so, rather than claiming to be the
   *  published artifact of the same number. */
  private static readonly DevVersion = `${PackageVersion}-dev`;

  static async run(): Promise<void> {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        target: { type: "string", default: "host" },
        // Defaults to the manifest's version marked `-dev`; the release
        // workflow passes the tag, having first checked the two agree.
        version: { type: "string", default: BuildBinary.DevVersion },
        out: { type: "string" },
        archive: { type: "boolean", default: false },
        "skip-ui": { type: "boolean", default: false },
      },
      strict: true,
    });

    const target = TargetTable.resolve(values.target!);
    const version = values.version!;
    const outfile = values.out ?? `silo${target.exe}`;

    if (!values["skip-ui"]) await BuildBinary.buildUi();
    await BuildBinary.compile(await EntryGenerator.write(), target, version, outfile);
    if (target.darwin) await CodeSigner.signAdHoc(outfile);

    const size = (await Bun.file(outfile).stat()).size;
    console.log(
      `${outfile}  ${(size / 1024 / 1024).toFixed(1)} MB  (${target.os}-${target.arch}, ${version})`
    );

    if (values.archive) {
      const archive = await Archiver.archive(outfile, target, version);
      const archiveSize = (await Bun.file(archive).stat()).size;
      console.log(`${archive}  ${(archiveSize / 1024 / 1024).toFixed(1)} MB`);
    }
  }

  /**
   * The compiled binary carries the admin UI, so the UI has to exist first and
   * has to be current. Skipping the build is a flag rather than a staleness
   * check because "is this dist newer than every source file" is a question
   * with an expensive right answer and a wrong cheap one; CI passes `--skip-ui`
   * having just built it once for all targets.
   */
  private static async buildUi(): Promise<void> {
    await CommandRunner.run([process.execPath, "run", "--cwd", "apps/admin", "build"]);
  }

  private static async compile(
    entry: string,
    target: BuildTarget,
    version: string,
    outfile: string
  ): Promise<void> {
    await fs.mkdir(path.dirname(path.resolve(outfile)), { recursive: true });

    // `process.execPath` is the Bun running this script, so the compile cannot
    // pick up a different Bun than the one invoked through `bun run build`.
    await CommandRunner.run([
      process.execPath,
      "build",
      entry,
      "--compile",
      "--target",
      target.bunTarget,
      "--define",
      `SILO_VERSION=${JSON.stringify(version)}`,
      "--outfile",
      outfile,
    ]);
  }
}

await BuildBinary.run();
