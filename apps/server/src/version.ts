import rootManifest from "../../../package.json";

/**
 * Substituted at bundle time by `tools/build/` passing
 * `--define SILO_VERSION='"1.2.3"'`, and undeclared everywhere else — which is
 * why the read below goes through `typeof`, the one operator that tolerates an
 * identifier that does not exist.
 */
declare const SILO_VERSION: string | undefined;

/**
 * The same claim from a release that has no bundle to define it: the container
 * image runs `bun run main.ts` over the source tree, so nothing is substituted
 * and `release.yml` stamps the environment at build time instead (D90). Read
 * only when the define is absent, which in a compiled binary it never is, and
 * empty is absent — an unpassed Docker `ARG` arrives as `""`.
 */
const stamped: string | undefined =
  typeof SILO_VERSION === "string" ? SILO_VERSION : process.env.SILO_VERSION?.trim() || undefined;

/**
 * What this silo calls itself: the root `package.json`'s `version`, plus a
 * `-dev` marker unless a release build overrode it (D28).
 *
 * The manifest is imported rather than restated so `bun build --compile`
 * bundles it — a binary reports the right version with no file to read at
 * runtime. `SILO_VERSION` marks the difference between a build and a *release*,
 * whichever way it arrives, and an operator who sets it by hand is describing
 * their own build to themselves.
 */
export const SiloVersion: string = stamped ?? `${rootManifest.version}-dev`;

/** The version the root manifest declares, without the `-dev` marking. Used by
 *  the release tooling and the drift test; runtime code wants `SiloVersion`. */
export const PackageVersion: string = rootManifest.version;
