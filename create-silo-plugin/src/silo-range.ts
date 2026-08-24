import pkg from "../package.json";

/**
 * The `"silo"` range a scaffolded manifest declares (D31/§13.2).
 *
 * The range is the entire compatibility gate — there is no separate plugin API
 * version — so getting the default wrong does not degrade, it refuses the
 * start. Every example in the spec and the README says `"^1"`, and every
 * example is right *about 1.0*; a plugin scaffolded today against a 0.2 build
 * and pinned `^1` would fail `silo plugin doctor` on the first run, which is
 * the worst possible first impression of a tool whose whole job is a working
 * starting point.
 *
 * So the default is derived from **this package's own version**, which
 * `scripts/set-version.ts` moves in lockstep with silo's. That is D28's rule
 * applied one package outward: the number is written in one place, and a
 * derived range cannot be stale in a way nobody can see. Today it emits
 * `^0.2`; the release that makes silo 1.0.0 makes it emit `^1` with no code
 * change and nothing to remember.
 */
export class SiloRange {
  /**
   * `0.2.0` → `^0.2`, `1.4.2` → `^1`.
   *
   * The 0.x form is narrower on purpose and matches what npm's caret already
   * means there: semver treats every 0.x minor as breaking, and so does silo
   * while its plugin contract is still moving. Widening a scaffolded plugin to
   * `^0` is one character the author can type; discovering that a hook payload
   * changed under them is not.
   */
  static default(version: string = SiloRange.toolVersion): string {
    const parts = version.trim().replace(/[-+].*$/, "").split(".");
    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    if (!Number.isInteger(major) || major < 0) return "^1";
    if (major > 0) return `^${major}`;
    return `^0.${Number.isInteger(minor) && minor >= 0 ? minor : 0}`;
  }

  /**
   * A shallow well-formedness check, not `semver.validRange`.
   *
   * Pulling `semver` in to validate a string the author typed would cost this
   * package the zero-dependency property for a check silo repeats at load with
   * the real parser. This one catches the shapes that are obviously not ranges
   * — empty, or containing whitespace-separated junk that is not a comparator
   * — and leaves the verdict to `silo plugin doctor`.
   */
  static looksValid(range: string): boolean {
    const trimmed = range.trim();
    if (trimmed.length === 0) return false;
    if (trimmed === "*" || trimmed === "x") return true;
    return /^[\^~><=]*\s*\d+(\.\d+)*(\.[x*])?([-+][0-9A-Za-z.-]+)?(\s+[\^~><=|\s\d.x*+-]+)?$/.test(trimmed);
  }

  /** What this scaffolder calls itself, read from its own manifest so the
   *  number has exactly one home here too. */
  static readonly toolVersion: string = pkg.version;
}
