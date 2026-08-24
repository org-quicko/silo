import path from "path";
import { NpmRegistry } from "./npm-registry";
import { PackageExtractor } from "./package-extractor";
import { TarballDownload } from "./tarball-download";
import type { FetchedPackage, PackageFetcher } from "./package-fetcher";

/**
 * `silo add silo-plugin-slug@^1` — the registry path (D32).
 *
 * The one source where integrity is checked against something silo did not
 * compute itself: the digest comes from the registry's metadata document and
 * the bytes come from a CDN, so a substituted tarball fails the comparison
 * even though both halves arrived over the same connection.
 *
 * That leaves one gap, and `--integrity` is what closes it: the registry
 * supplies *both* halves, so a compromised registry can serve a bad tarball
 * with a digest that matches it. An operator who knows the digest independently
 * can pin it, and then both must agree. The two are joined into one SRI string
 * rather than checked in sequence because `Integrity.verify` already requires
 * **every** digest it is given to match — so this needs no second code path,
 * and the check still happens before a byte is written.
 *
 * Nothing here runs `npm`, and nothing runs a lifecycle script (§13.8). The
 * package is metadata plus a tarball, and this fetches exactly those two.
 */
export class NpmFetcher implements PackageFetcher {
  constructor(
    private readonly name: string,
    private readonly range: string,
    private readonly registry: NpmRegistry,
    private readonly expected?: string
  ) {}

  async fetch(staging: string): Promise<FetchedPackage> {
    const release = await this.registry.resolve(this.name, this.range);
    const what = `plugin "${this.name}@${release.version}"`;

    const digests =
      this.expected === undefined ? release.integrity : `${release.integrity} ${this.expected}`;

    const file = path.join(staging, "package.tgz");
    await TarballDownload.to(file, release.tarball, digests, what);

    const into = path.join(staging, "package");
    await PackageExtractor.extract(file, into, what);

    return {
      dir: await PackageExtractor.packageRoot(into, what),
      resolved: release.version,
      integrity: release.integrity,
    };
  }
}
