/**
 * Getting a plugin's bytes into a staging directory, whatever they came from
 * (D32).
 *
 * The port exists so `PluginInstaller` has exactly one shape to talk to: five
 * sources differ entirely in how they *acquire* a package and not at all in
 * what happens afterwards — validate the manifest, gate on the version range,
 * move it into place, record it. Splitting there keeps the security-relevant
 * half (`PackageExtractor`) shared by every fetcher rather than reimplemented
 * per source, which is how the interesting one gets missed.
 */
export interface PackageFetcher {
  /** Unpack into `staging` and return where the package actually landed.
   *  Implementations never touch the plugins directory — the installer decides
   *  whether what arrived is allowed to become an installed plugin. */
  fetch(staging: string): Promise<FetchedPackage>;
}

export interface FetchedPackage {
  /** The directory holding `package.json`. */
  dir: string;

  /** What the spec resolved to, for the lockfile and for the operator to read
   *  back: an npm version, a commit sha, an absolute path, a URL. */
  resolved: string;

  /** The digest these bytes were checked against, when there was one. Absent
   *  for a local directory (nothing was transferred) and for a git checkout
   *  (pinned by commit instead). */
  integrity?: string;
}
