import pkg from "../package.json";

/**
 * The version stamped into a release build, substituted at bundle time by
 * `scripts/build.ts` passing `--define SILO_VERSION='"1.2.3"'`.
 *
 * Undeclared everywhere else, which is why the read below goes through
 * `typeof` — the one operator that tolerates an identifier that does not exist.
 */
declare const SILO_VERSION: string | undefined;

/**
 * What this silo calls itself: the `version` in the root `package.json`, and
 * nothing else.
 *
 * That file is the single place the version is written. Everything downstream
 * derives from it — the compiled binary, the release archives, the RPM, the
 * Homebrew formula — and the release workflow refuses to publish a tag that
 * disagrees with it, so the number cannot be true in one artifact and stale in
 * the next.
 *
 * Importing the manifest rather than duplicating the literal is what makes that
 * hold for a compiled binary too: `bun build --compile` bundles the JSON, so a
 * binary reports the right version with no file to read at runtime and no build
 * flag required. `SILO_VERSION` then exists only to mark the difference between
 * a build and a *release*: a release passes the tag it was cut from, and every
 * other build says so with a `-dev` suffix rather than quietly claiming to be
 * the released artifact of the same number.
 */
export const SiloVersion: string =
  typeof SILO_VERSION === "string" ? SILO_VERSION : `${pkg.version}-dev`;

/** The version the manifest declares, without the `-dev` marking. Used by the
 *  release tooling and the drift test; runtime code wants `SiloVersion`. */
export const PackageVersion: string = pkg.version;
