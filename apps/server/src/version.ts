import rootManifest from "../../../package.json";

/**
 * Substituted at bundle time by `tools/build/` passing
 * `--define SILO_VERSION='"1.2.3"'`, and undeclared everywhere else — which is
 * why the read below goes through `typeof`, the one operator that tolerates an
 * identifier that does not exist.
 */
declare const SILO_VERSION: string | undefined;

/**
 * What this silo calls itself: the root `package.json`'s `version`, plus a
 * `-dev` marker unless a release build overrode it (D28).
 *
 * The manifest is imported rather than restated so `bun build --compile`
 * bundles it — a binary reports the right version with no file to read at
 * runtime. `SILO_VERSION` marks the difference between a build and a *release*.
 */
export const SiloVersion: string =
  typeof SILO_VERSION === "string" ? SILO_VERSION : `${rootManifest.version}-dev`;

/** The version the root manifest declares, without the `-dev` marking. Used by
 *  the release tooling and the drift test; runtime code wants `SiloVersion`. */
export const PackageVersion: string = rootManifest.version;
