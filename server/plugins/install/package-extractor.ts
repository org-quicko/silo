import fs from "fs/promises";
import path from "path";
import { t, x } from "tar";
import { EntryUtils } from "../../core/domain/entry-utils";

/**
 * Unpacking downloaded bytes into a directory, on silo's terms (D32/§13.8).
 *
 * §13.8 states one requirement of whatever installer arrives — that it reuse
 * `EntryUtils.assertSafeSegment` when extracting — and this is where that
 * happens. Every path component of every entry goes through the same check
 * that guards a project or collection id on the fs adapter, which is not a
 * coincidence: both are "a string from outside becoming a filename", and there
 * should be exactly one answer to that in the codebase.
 *
 * The archive is **validated in full before a single byte is written**. A
 * filter that skipped bad entries mid-extraction would leave half a package on
 * disk and, worse, would treat a tarball trying to escape its directory as a
 * package with a few odd files in it rather than as the attack it is.
 */
export class PackageExtractor {
  /** A published plugin is source and a manifest. Anything near these bounds is
   *  not that, and refusing is cheaper than filling a disk to find out. */
  private static readonly MaxBytes = 64 * 1024 * 1024;
  private static readonly MaxEntries = 20_000;

  static async extract(tarball: string, into: string, what: string): Promise<void> {
    await PackageExtractor.assertSafe(tarball, what);
    await fs.mkdir(into, { recursive: true });
    // tar refuses absolute paths and `..` on its own with the defaults left
    // alone; the pass above is what makes the refusal *loud*, and what applies
    // silo's own segment rule on top.
    await x({ file: tarball, cwd: into });
  }

  /**
   * Walk the archive without writing anything, and refuse the first entry that
   * has no business in a plugin directory.
   *
   * The violation is **recorded and thrown afterwards**, never thrown out of
   * `onentry`. Throwing from the callback escapes into tar's stream, which
   * settles neither way: the archive that most needs refusing would instead
   * hang the command that was refusing it. Anything after the first violation
   * is skipped rather than examined — the answer is already no, and the point
   * of the walk is to reach the throw, not to inventory the attack.
   */
  private static async assertSafe(tarball: string, what: string): Promise<void> {
    let entries = 0;
    let bytes = 0;
    let violation: string | null = null;

    const check = (entry: any): void => {
      if (++entries > PackageExtractor.MaxEntries) {
        throw new Error(`${what}: archive holds more than ${PackageExtractor.MaxEntries} files`);
      }
      bytes += Number(entry.size) || 0;
      if (bytes > PackageExtractor.MaxBytes) {
        throw new Error(
          `${what}: archive unpacks to more than ${PackageExtractor.MaxBytes / (1024 * 1024)} MB`
        );
      }
      PackageExtractor.assertEntryType(entry, what);
      PackageExtractor.assertSafeMode(entry, what);
      PackageExtractor.assertSafePath(String(entry.path), what);
    };

    await t({
      file: tarball,
      onentry: (entry: any) => {
        if (violation !== null) return;
        try {
          check(entry);
        } catch (err: any) {
          violation = err.message;
        }
      },
    });

    if (violation !== null) throw new Error(violation);
    if (entries === 0) throw new Error(`${what}: archive is empty`);
  }

  /**
   * Files and directories only.
   *
   * A symlink is the shape that turns "extract into this directory" into
   * "write anywhere": `node_modules -> /` costs one entry and every later
   * entry escapes through it. Hard links do the same to files that already
   * exist. Device nodes and FIFOs have no meaning in a package at all. None of
   * these appears in a plugin published by anyone acting in good faith, so
   * refusing costs nothing real.
   */
  private static assertEntryType(entry: any, what: string): void {
    const type = String(entry.type ?? "File");
    if (type === "File" || type === "Directory" || type === "OldFile" || type === "ContiguousFile") {
      return;
    }
    // pax/GNU metadata entries carry no path of their own and tar consumes
    // them before the entry they describe.
    if (type.endsWith("ExtendedHeader") || type === "GlobalExtendedHeader" || type.endsWith("LongPath") || type.endsWith("LongLink")) {
      return;
    }
    throw new Error(
      `${what}: archive contains a ${type} ("${entry.path}"). ` +
        `A plugin package holds files and directories only. Not installing.`
    );
  }

  /**
   * No setuid, setgid or sticky bit.
   *
   * These are the one weapon in an archive that does not need the plugin to
   * ever load. `tar` carries an entry's mode through to the mode it creates the
   * file with, keeping all twelve bits, and the process umask masks only the
   * low nine — so a `0o4755` entry becomes a setuid file on disk during
   * *extraction*, which happens before the manifest is judged, before the
   * claims prompt, and even under `--no-register` where the operator has said
   * they do not want the thing to run. Everything else about installing a
   * plugin is a decision the operator makes; this would be a privilege granted
   * by the tar header.
   *
   * Refused rather than stripped, matching this class's policy everywhere else:
   * a plugin package containing a setuid binary does not exist among people
   * acting in good faith, so silence would be the wrong answer. Stripping would
   * also leave silo betting on `tar` never changing how it applies modes.
   */
  private static assertSafeMode(entry: any, what: string): void {
    const mode = Number(entry.mode);
    if (!Number.isFinite(mode) || (mode & 0o7000) === 0) return;

    throw new Error(
      `${what}: archive entry "${entry.path}" sets setuid/setgid/sticky bits ` +
        `(mode ${(mode & 0o7777).toString(8)}). A plugin package has no business ` +
        `doing that. Not installing.`
    );
  }

  /** Relative, no `..`, no drive letter, and every component a name the fs
   *  adapter would accept. */
  static assertSafePath(raw: string, what: string): void {
    const normalized = raw.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
      throw new Error(`${what}: archive contains an absolute path ("${raw}"). Not installing.`);
    }

    const segments = normalized.split("/").filter((segment) => segment.length > 0 && segment !== ".");
    if (segments.length === 0) return;

    for (const segment of segments) {
      try {
        EntryUtils.assertSafeSegment(segment, "archive path component");
      } catch (err: any) {
        throw new Error(`${what}: unsafe path "${raw}" in archive — ${err.message}. Not installing.`);
      }
    }
  }

  /**
   * The directory holding `package.json`, given a freshly unpacked staging dir.
   *
   * npm roots every tarball at `package/`, git checkouts and hand-rolled
   * archives root at whatever they like, and a `--strip 1` that guessed wrong
   * would silently produce an empty directory. So the layout is *read* rather
   * than assumed: unwrap a lone directory, at most a few levels, and stop at
   * the first one holding a manifest.
   */
  static async packageRoot(dir: string, what: string): Promise<string> {
    let current = dir;
    for (let depth = 0; depth < 4; depth++) {
      if (await PackageExtractor.isFile(path.join(current, "package.json"))) return current;

      const contents = await fs.readdir(current, { withFileTypes: true });
      const dirs = contents.filter((e) => e.isDirectory());
      if (dirs.length !== 1 || contents.length !== 1) break;
      current = path.join(current, dirs[0]!.name);
    }
    throw new Error(
      `${what}: no package.json found. A plugin is a package — see the Plugins section of the README.`
    );
  }

  private static async isFile(file: string): Promise<boolean> {
    try {
      return (await fs.stat(file)).isFile();
    } catch {
      return false;
    }
  }
}
