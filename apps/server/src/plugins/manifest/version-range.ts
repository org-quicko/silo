import semver from "semver";

/**
 * Whether this silo satisfies the range a plugin's manifest declares (D31).
 *
 * There is no separate plugin API version — D13 settled that external consumers
 * pin the binary version, and D28 removed the version number's spare homes
 * because a stale copy is invisible. So a plugin says `"silo": "^1"` and this
 * one comparison is the entire compatibility gate: pass it and the plugin
 * loads, fail it and the start is refused with the range named.
 *
 * Ranges are ordinary npm ranges, evaluated by `semver`. The one thing this
 * class adds is the prerelease rule below, which is a deliberate *deviation*
 * from semver rather than an implementation of it — and is the reason there is
 * a class here at all instead of two bare calls at the call sites.
 */
export class VersionRange {
  /**
   * Whether `version` satisfies `range`.
   *
   * The version's prerelease and build metadata are **dropped before
   * comparison**. Semver says a prerelease satisfies no range that does not
   * itself name one, and every non-release build of silo carries `-dev` (D28) —
   * so honouring that rule would mean no plugin ever loads except against a
   * tagged release, which is exactly backwards for the situation plugins are
   * developed in. `includePrerelease` is not the same thing and is not what is
   * wanted: it would also let a plugin pinned to `^1` load against `2.0.0-rc.1`.
   */
  static satisfies(version: string, range: string): boolean {
    const release = VersionRange.release(version);
    if (!release) return false;
    // `semver.satisfies` throws on an unparseable range. Callers reach this
    // through `ManifestReader`, which has already run `isValid`, but the
    // invariant worth keeping is that a range nobody can evaluate is never a
    // *match* — a throw here would surface as an internal error instead of the
    // manifest error it is.
    if (!VersionRange.isValid(range)) return false;
    return semver.satisfies(release, range);
  }

  /** Whether `range` is a range at all. A manifest that declares something
   *  unevaluatable is a manifest error, not a silent match. */
  static isValid(range: string): boolean {
    return semver.validRange(range) !== null;
  }

  /** `1.2.3` from `1.2.3-dev` or `1.2.3-rc.1+build7`, or null if it is not a
   *  version. Coerced rather than parsed strictly, so a partial version is
   *  still readable. */
  private static release(version: string): string | null {
    const parsed = semver.parse(version.trim(), { loose: true }) ?? semver.coerce(version.trim());
    return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : null;
  }
}
