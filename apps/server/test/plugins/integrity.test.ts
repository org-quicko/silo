import { describe, test, expect } from "bun:test";
import { Integrity, UrlFetcher } from "../../src/plugins";

/**
 * The digest machinery, and the one flag that turns it on (D32).
 *
 * `--integrity` is the entire verification story for a bare URL — the one
 * source with no metadata document to compare against — so the failure mode
 * that matters is not a wrong answer but a *skipped question*. Most of this
 * file exists to pin that: a digest that cannot be used has to stop the
 * install, never quietly become no digest at all.
 */
describe("Integrity", () => {
  const bytes = new TextEncoder().encode("a plugin tarball, notionally");
  const digest = Integrity.compute(bytes);

  test("what it computes is what it verifies", () => {
    expect(digest).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    expect(() => Integrity.verify(bytes, digest, "test")).not.toThrow();
  });

  test("a byte's difference is a refusal", () => {
    const tampered = new TextEncoder().encode("a plugin tarball, notionallY");
    expect(() => Integrity.verify(tampered, digest, "test")).toThrow(/integrity check failed/);
  });

  test("every digest must match, not merely one of them", () => {
    // Matching "any" would let whoever wrote the string weaken the check by
    // appending an algorithm silo happens to prefer.
    const bogus = `sha256-${Buffer.alloc(32).toString("base64")}`;
    expect(() => Integrity.verify(bytes, `${digest} ${bogus}`, "test")).toThrow(
      /integrity check failed/
    );
  });

  test("an empty digest is a refusal, not a pass", () => {
    expect(() => Integrity.verify(bytes, "", "test")).toThrow(/empty integrity string/);
    expect(() => Integrity.verify(bytes, "   ", "test")).toThrow(/empty integrity string/);
  });

  test("an unknown algorithm is refused rather than skipped", () => {
    expect(() => Integrity.verify(bytes, "md5-abcd", "test")).toThrow(/unsupported hash/);
  });

  test("a digest of the wrong length for its algorithm is malformed", () => {
    expect(Integrity.isValid("sha512-YWJj")).toBe(false);
    expect(Integrity.isValid("sha512-")).toBe(false);
    expect(Integrity.isValid("notadigest")).toBe(false);
  });

  test("isValid says no to the empty string, which is what the flag check leans on", () => {
    expect(Integrity.isValid("")).toBe(false);
    expect(Integrity.isValid("   ")).toBe(false);
    expect(Integrity.isValid(digest)).toBe(true);
  });

  test("npm's legacy hex shasum becomes a digest one code path can check", () => {
    const sha1 = "a".repeat(40);
    expect(Integrity.fromShasum(sha1, "test")).toMatch(/^sha1-/);
    expect(() => Integrity.fromShasum("nope", "test")).toThrow(/malformed shasum/);
  });
});

/**
 * The regression that prompted this file.
 *
 * An empty `--integrity` — `--integrity "$UNSET_VAR"` in a CI script, or a bare
 * `--integrity=` — used to pass three gates at once: falsy where a malformed
 * digest is rejected, falsy again where the comparison happens, and
 * `!== undefined` where `silo add` decides whether to warn that nothing checked
 * the download. The result was an install *quieter* than one with no flag at
 * all, recording `""` in the lockfile instead of the computed pin. Validation
 * now happens once, in the constructor, on presence rather than truthiness.
 */
describe("UrlFetcher's digest flag", () => {
  const url = "https://example.com/silo-plugin-slug.tgz";
  const valid = Integrity.compute(new TextEncoder().encode("x"));

  test("an empty --integrity is refused before anything is downloaded", () => {
    expect(() => new UrlFetcher(url, "")).toThrow(/is not a digest/);
  });

  test("a whitespace-only --integrity is refused", () => {
    expect(() => new UrlFetcher(url, "   ")).toThrow(/is not a digest/);
  });

  test("a malformed --integrity is refused", () => {
    expect(() => new UrlFetcher(url, "sha512-tooshort")).toThrow(/is not a digest/);
    expect(() => new UrlFetcher(url, "deadbeef")).toThrow(/is not a digest/);
  });

  test("a real digest is accepted, and reports itself as verified", () => {
    expect(new UrlFetcher(url, valid).verified).toBe(true);
  });

  test("no flag is allowed, and reports itself as unverified so add can warn", () => {
    // The documented release-asset case: not refused, but it must not claim a
    // check it did not make — `PluginInstaller` reads this to decide whether to
    // say "nothing verified these bytes but TLS".
    expect(new UrlFetcher(url).verified).toBe(false);
    expect(new UrlFetcher(url, undefined).verified).toBe(false);
  });
});
