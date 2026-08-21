import { parseArgs } from "util";
import fs from "fs/promises";
import path from "path";
import { create as createTar } from "tar";

/** A platform silo can be built for, and the names that follow from it. */
interface Target {
  /** What `bun build --compile --target` wants. */
  readonly bunTarget: string;
  /** Goes in artifact names: `silo-1.2.3-<os>-<arch>.tar.gz`. */
  readonly os: string;
  readonly arch: string;
  /** Windows executables need the suffix; nothing else does. */
  readonly exe: string;
  /** Mach-O, and therefore needs a signature to run at all (see `signAdHoc`). */
  readonly darwin: boolean;
}

/**
 * Builds the `silo` executable: admin UI, embedded assets, compile, signature,
 * and optionally the release tarball.
 *
 * This is a script rather than a `package.json` one-liner because a release
 * build is four steps that have to happen in order and two of them are
 * platform-conditional. It is the single build path — `bun run build` and the
 * release workflow run this same file, differing only in flags, so a release
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
 *   --skip-ui         don't rebuild the admin UI; ui/dist must already exist
 */
export class BuildBinary {
  private static readonly cliEntry = "./server/cli/cli";
  private static readonly uiDist = "ui/dist";
  private static readonly generatedDir = ".build";
  private static readonly distDir = "dist";
  private static readonly devVersion = "0.1.0-dev";

  /** Shipped alongside the executable. The licence is not optional: silo is
   *  AGPL, and a binary handed to someone travels with its terms. */
  private static readonly archiveExtras = ["LICENSE", "README.md"];

  private static readonly targets: Record<string, Target> = {
    "darwin-arm64": { bunTarget: "bun-darwin-arm64", os: "darwin", arch: "arm64", exe: "", darwin: true },
    "darwin-x64": { bunTarget: "bun-darwin-x64", os: "darwin", arch: "x64", exe: "", darwin: true },
    "linux-x64": { bunTarget: "bun-linux-x64", os: "linux", arch: "x64", exe: "", darwin: false },
    "linux-arm64": { bunTarget: "bun-linux-arm64", os: "linux", arch: "arm64", exe: "", darwin: false },
    "windows-x64": { bunTarget: "bun-windows-x64", os: "windows", arch: "x64", exe: ".exe", darwin: false },
  };

  static async run(): Promise<void> {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        target: { type: "string", default: "host" },
        version: { type: "string", default: BuildBinary.devVersion },
        out: { type: "string" },
        archive: { type: "boolean", default: false },
        "skip-ui": { type: "boolean", default: false },
      },
      strict: true,
    });

    const target = BuildBinary.resolveTarget(values.target!);
    const version = values.version!;
    const outfile = values.out ?? `silo${target.exe}`;

    if (!values["skip-ui"]) await BuildBinary.buildUi();
    const entry = await BuildBinary.generateEntry();

    await BuildBinary.compile(entry, target, version, outfile);
    if (target.darwin) await BuildBinary.signAdHoc(outfile);

    const size = (await Bun.file(outfile).stat()).size;
    console.log(`${outfile}  ${(size / 1024 / 1024).toFixed(1)} MB  (${target.os}-${target.arch}, ${version})`);

    if (values.archive) {
      const archive = await BuildBinary.archive(outfile, target, version);
      console.log(`${archive}  ${((await Bun.file(archive).stat()).size / 1024 / 1024).toFixed(1)} MB`);
    }
  }

  /** `host` resolves through the running process, so `bun run build` needs no
   *  flags and cannot name a target that disagrees with the machine. */
  private static resolveTarget(name: string): Target {
    if (name !== "host") {
      const target = BuildBinary.targets[name];
      if (!target) {
        throw new Error(`unknown target "${name}" (have: ${Object.keys(BuildBinary.targets).join(", ")})`);
      }
      return target;
    }

    const os = process.platform === "win32" ? "windows" : process.platform;
    const host = BuildBinary.targets[`${os}-${process.arch}`];
    if (!host) throw new Error(`no target for this host (${process.platform}-${process.arch})`);
    return host;
  }

  /**
   * The compiled binary carries the admin UI, so the UI has to exist first and
   * has to be current. Skipping the build is a flag rather than a staleness
   * check because "is this dist newer than every source file" is a question
   * with an expensive right answer and a wrong cheap one; CI passes `--skip-ui`
   * having just built it once for all four targets.
   */
  private static async buildUi(): Promise<void> {
    await BuildBinary.exec([process.execPath, "run", "--cwd", "ui", "build"]);
  }

  /**
   * Writes the entrypoint the compile actually uses: the real CLI, preceded by
   * a `with { type: "file" }` import of every file in `ui/dist`.
   *
   * Those imports survive `--compile` as paths under Bun's virtual filesystem,
   * which is what makes an installed `silo` serve its UI from any working
   * directory. Bun content-hashes the embedded names, so the map from request
   * path to embedded path is generated here and handed to `UiAssets` before the
   * CLI starts — importing `server/main.ts` instead would run the CLI on import,
   * before there was anything to hand it.
   *
   * Generated rather than committed because it names files that only exist
   * after a UI build, and their names change with every build.
   */
  private static async generateEntry(): Promise<string> {
    const files = await BuildBinary.walk(BuildBinary.uiDist);
    if (files.length === 0) {
      throw new Error(`${BuildBinary.uiDist} is empty or missing — build the admin UI, or drop --skip-ui`);
    }

    const imports: string[] = [];
    const entries: string[] = [];
    files.forEach((relative, i) => {
      const ident = `asset${i}`;
      imports.push(`import ${ident} from ${JSON.stringify(`../${BuildBinary.uiDist}/${relative}`)} with { type: "file" };`);
      entries.push(`  ${JSON.stringify(`/${relative}`)}: ${ident},`);
    });

    const source = `// GENERATED by scripts/build.ts. Do not edit, do not commit.
import { UiAssets } from "../server/http/ui-assets";
import { Cli } from "${BuildBinary.cliEntry.replace("./", "../")}";
${imports.join("\n")}

UiAssets.useEmbedded({
${entries.join("\n")}
});

Cli.run();
`;

    await fs.mkdir(BuildBinary.generatedDir, { recursive: true });
    const entry = path.join(BuildBinary.generatedDir, "entry.ts");
    await Bun.write(entry, source);
    console.log(`embedding ${files.length} UI files from ${BuildBinary.uiDist}/`);
    return `./${entry}`;
  }

  /** Every file under `dir`, as paths relative to it, with `/` separators —
   *  they become both import specifiers and URL paths. */
  private static async walk(dir: string, prefix = ""): Promise<string[]> {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const found: string[] = [];
    for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) found.push(...(await BuildBinary.walk(path.join(dir, dirent.name), relative)));
      else found.push(relative);
    }
    return found;
  }

  private static async compile(entry: string, target: Target, version: string, outfile: string): Promise<void> {
    await fs.mkdir(path.dirname(path.resolve(outfile)), { recursive: true });

    // `process.execPath` is the Bun running this script, so the compile cannot
    // pick up a different Bun than the one invoked through `bun run build`.
    await BuildBinary.exec([
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

  /**
   * `bun build --compile` appends its payload to a copy of the Bun executable,
   * which invalidates the signature the Mach-O arrived with. macOS on arm64
   * does not warn about that — the kernel refuses to exec an improperly signed
   * binary and the process dies on SIGKILL — so the ad-hoc re-sign is what makes
   * a Darwin artifact runnable at all, not a nicety.
   *
   * `--force` replaces an existing signature instead of failing on one, so the
   * step stays correct whether or not Bun signed its own output.
   *
   * `codesign` is macOS-only, and a Darwin target cross-compiled from Linux
   * therefore cannot be signed where it is built. That is a warning rather than
   * an error so the case stays diagnosable, but the release workflow builds both
   * Darwin targets on a macOS runner precisely to avoid it — `codesign` signs an
   * x86_64 Mach-O from an arm64 host quite happily.
   */
  private static async signAdHoc(artifact: string): Promise<void> {
    if (process.platform !== "darwin") {
      console.warn(`warning: ${artifact} is unsigned — a Darwin build must be signed on macOS to run`);
      return;
    }
    await BuildBinary.exec(["codesign", "--sign", "-", "--force", artifact]);
  }

  /**
   * Stages the executable next to the licence and README and tars the three.
   *
   * Staging rather than tarring in place is what keeps the archive's internal
   * layout independent of where the build happened to write: the tarball holds
   * `silo`, never `dist/linux-x64/silo`, which is what Homebrew's `bin.install
   * "silo"` expects. `portable` drops the uid, gid, and user names of whichever
   * runner produced it, leaving an archive that is a function of its contents.
   */
  private static async archive(outfile: string, target: Target, version: string): Promise<string> {
    const name = `silo-${version}-${target.os}-${target.arch}`;
    const stage = path.join(BuildBinary.distDir, `stage-${target.os}-${target.arch}`);
    const binaryName = `silo${target.exe}`;

    await fs.rm(stage, { recursive: true, force: true });
    await fs.mkdir(stage, { recursive: true });

    await fs.copyFile(outfile, path.join(stage, binaryName));
    await fs.chmod(path.join(stage, binaryName), 0o755);
    for (const extra of BuildBinary.archiveExtras) await fs.copyFile(extra, path.join(stage, extra));

    const archive = path.join(BuildBinary.distDir, `${name}.tar.gz`);
    await createTar(
      { file: archive, cwd: stage, gzip: true, portable: true },
      [binaryName, ...BuildBinary.archiveExtras]
    );

    await fs.rm(stage, { recursive: true, force: true });
    return archive;
  }

  private static async exec(command: string[]): Promise<void> {
    const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
    const status = await child.exited;
    if (status !== 0) {
      throw new Error(`${command[0]} exited with ${status}`);
    }
  }
}

await BuildBinary.run();
