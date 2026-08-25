/** Where a build reads from and writes to, relative to the repo root. */
export class BuildPaths {
  /** The real CLI the compiled entrypoint imports. */
  static readonly CliEntry = "./apps/server/src/cli/cli";
  /** The admin UI's built output, embedded into the executable. */
  static readonly UiDist = "apps/admin/dist";
  /** Generated, never committed: it names files that only exist after a UI
   *  build, and their names change with every build. */
  static readonly GeneratedDir = ".build";
  /** Release artifacts. */
  static readonly DistDir = "dist";
  /** Shipped alongside the executable. The licence is not optional: silo is
   *  AGPL, and a binary handed to someone travels with its terms. */
  static readonly ArchiveExtras = ["LICENSE", "README.md"];
}
