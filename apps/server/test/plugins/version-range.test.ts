import { describe, test, expect } from "bun:test";
import { VersionRange } from "../../src/plugins/manifest/version-range";

/**
 * The range a manifest declares against `SiloVersion` (D31).
 *
 * There is no separate plugin API version, so this one comparison decides
 * whether a plugin loads at all. Ranges are ordinary npm ranges — `semver`
 * evaluates them — and what is pinned here is the behaviour silo adds on top,
 * plus enough of the common cases to catch a bad upgrade of the dependency.
 */
describe("VersionRange", () => {
  test("caret keeps the leftmost non-zero component", () => {
    expect(VersionRange.satisfies("1.4.2", "^1")).toBe(true);
    expect(VersionRange.satisfies("1.0.0", "^1")).toBe(true);
    expect(VersionRange.satisfies("2.0.0", "^1")).toBe(false);
    expect(VersionRange.satisfies("0.9.9", "^1")).toBe(false);

    // Semver's own reading of 0.x: every minor is breaking. This is exactly the
    // churn D31 avoids by landing plugins immediately before 1.0.
    expect(VersionRange.satisfies("0.2.9", "^0.2")).toBe(true);
    expect(VersionRange.satisfies("0.3.0", "^0.2")).toBe(false);
  });

  test("tilde, comparators, exact, partial and wildcard ranges", () => {
    expect(VersionRange.satisfies("1.2.9", "~1.2")).toBe(true);
    expect(VersionRange.satisfies("1.3.0", "~1.2")).toBe(false);
    expect(VersionRange.satisfies("1.5.0", ">=1.2 <2")).toBe(true);
    expect(VersionRange.satisfies("2.0.0", ">=1.2 <2")).toBe(false);
    expect(VersionRange.satisfies("1.2.7", "1.2")).toBe(true);
    expect(VersionRange.satisfies("1.3.0", "1.2")).toBe(false);
    expect(VersionRange.satisfies("1.2.3", "1.2.3")).toBe(true);
    expect(VersionRange.satisfies("3.1.0", "^1 || ^3")).toBe(true);
    expect(VersionRange.satisfies("2.1.0", "^1 || ^3")).toBe(false);
    expect(VersionRange.satisfies("9.9.9", "*")).toBe(true);

    // Accepted because the range vocabulary is npm's, not a subset of our own.
    // An earlier hand-rolled matcher rejected these; delegating means the set of
    // things a manifest may say is whatever `semver` parses, which is the trade
    // taken when the dependency went in.
    expect(VersionRange.satisfies("1.4.0", "1.x")).toBe(true);
    expect(VersionRange.satisfies("2.0.0", "1.x")).toBe(false);
  });

  /**
   * The one deliberate deviation from semver, and the reason this class exists
   * rather than two bare `semver` calls at the call sites.
   *
   * Semver says a prerelease satisfies no range that does not itself name one.
   * Every non-release build carries `-dev` (D28), so honouring that would mean
   * no plugin ever loads except against a tagged release — backwards for the
   * situation plugins are actually written in.
   */
  test("a -dev build satisfies the same ranges its release would", () => {
    expect(VersionRange.satisfies("0.2.0-dev", "^0.2")).toBe(true);
    expect(VersionRange.satisfies("1.0.0-dev", "^1")).toBe(true);
    expect(VersionRange.satisfies("1.0.0-rc.1+build7", ">=1")).toBe(true);

    // ...but the suffix is *dropped*, not waved through: this is not
    // `includePrerelease`, which would also let a plugin pinned to ^1 load
    // against a 2.0.0 release candidate.
    expect(VersionRange.satisfies("2.0.0-rc.1", "^1")).toBe(false);
  });

  test("an unevaluatable range is invalid, and never a match", () => {
    expect(VersionRange.isValid("^1")).toBe(true);
    expect(VersionRange.isValid(">=1.2 <2")).toBe(true);
    expect(VersionRange.isValid("*")).toBe(true);
    expect(VersionRange.isValid("")).toBe(true);

    // A dist-tag is not a range. `ManifestReader` turns this into a manifest
    // error naming the plugin.
    expect(VersionRange.isValid("latest")).toBe(false);
    expect(VersionRange.isValid("not-a-range")).toBe(false);

    // And `satisfies` answers false rather than throwing, so an unevaluatable
    // range can never surface as an internal error instead of a manifest one.
    expect(VersionRange.satisfies("1.0.0", "not-a-range")).toBe(false);
  });

  test("a version that is not a version matches nothing", () => {
    expect(VersionRange.satisfies("", "*")).toBe(false);
    expect(VersionRange.satisfies("banana", "*")).toBe(false);
  });
});
