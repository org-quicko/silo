import { createHash } from "crypto";

/**
 * Subresource-Integrity strings — `sha512-<base64>` — as the one thing that
 * says these are the bytes that were meant (D32).
 *
 * §12.8 named integrity pinning first among the parts of an installer, and it
 * is the part that keeps its value with no infrastructure behind it: the
 * digest npm publishes is checked here, and the digest checked here is what
 * goes in the lockfile, so a re-install of the same spec either produces the
 * same bytes or refuses.
 *
 * This is deliberately not a signature policy. A digest says the bytes match
 * what the registry served; it says nothing about who wrote them. Signing
 * needs a trust root, and choosing one is not this change's to make.
 */
export class Integrity {
  /** Digest length in bytes, which is also the set of algorithms understood.
   *  `sha1` is here only because packages published before `dist.integrity`
   *  existed carry nothing else; nothing ever *computes* one. */
  private static readonly Algorithms: Record<string, number> = {
    sha512: 64,
    sha384: 48,
    sha256: 32,
    sha1: 20,
  };

  static compute(bytes: Uint8Array, algorithm: string = "sha512"): string {
    Integrity.assertKnown(algorithm);
    return `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`;
  }

  /**
   * Throws unless `bytes` hashes to `expected`.
   *
   * An SRI string may carry several space-separated digests, and **every** one
   * must match. Matching "any" would let whoever wrote the string weaken the
   * check by appending an algorithm silo happens to prefer.
   */
  static verify(bytes: Uint8Array, expected: string, what: string): void {
    const entries = expected.trim().split(/\s+/).filter((entry) => entry.length > 0);
    if (entries.length === 0) throw new Error(`${what}: empty integrity string`);

    for (const entry of entries) {
      const { algorithm, digest } = Integrity.parse(entry, what);
      const actual = createHash(algorithm).update(bytes).digest("base64");
      if (actual !== digest) {
        throw new Error(
          `${what}: integrity check failed.\n` +
            `  expected ${algorithm}-${digest}\n` +
            `  actual   ${algorithm}-${actual}\n` +
            `These are not the bytes that were published. Nothing was installed.`
        );
      }
    }
  }

  /** npm's legacy `dist.shasum` — hex sha1 — as an SRI string, so one code
   *  path checks both it and `dist.integrity`. */
  static fromShasum(hex: string, what: string): string {
    if (!/^[0-9a-f]{40}$/i.test(hex)) throw new Error(`${what}: malformed shasum "${hex}"`);
    return `sha1-${Buffer.from(hex, "hex").toString("base64")}`;
  }

  /** Whether a string is a usable digest, for validating `--integrity` before
   *  anything is downloaded rather than after. */
  static isValid(value: string): boolean {
    try {
      const entries = value.trim().split(/\s+/).filter((entry) => entry.length > 0);
      if (entries.length === 0) return false;
      for (const entry of entries) Integrity.parse(entry, "integrity");
      return true;
    } catch {
      return false;
    }
  }

  private static parse(entry: string, what: string): { algorithm: string; digest: string } {
    const dash = entry.indexOf("-");
    if (dash <= 0) {
      throw new Error(`${what}: malformed integrity "${entry}" (expected "sha512-<base64>")`);
    }
    const algorithm = entry.slice(0, dash).toLowerCase();
    // SRI allows `?options` after the digest. npm never writes any, and silo
    // understands none, so they are dropped rather than rejected.
    const digest = entry.slice(dash + 1).split("?")[0]!;

    Integrity.assertKnown(algorithm, what);
    if (Buffer.from(digest, "base64").length !== Integrity.Algorithms[algorithm]) {
      throw new Error(`${what}: "${algorithm}" digest is the wrong length`);
    }
    return { algorithm, digest };
  }

  private static assertKnown(algorithm: string, what = "integrity"): void {
    if (!(algorithm in Integrity.Algorithms)) {
      throw new Error(
        `${what}: unsupported hash "${algorithm}" ` +
          `(understands ${Object.keys(Integrity.Algorithms).join(", ")})`
      );
    }
  }
}
