import semver from "semver";
import { Integrity } from "./integrity";

export interface ResolvedRelease {
  version: string;
  tarball: string;
  integrity: string;
}

/**
 * Reading an npm registry, and nothing else (D32).
 *
 * Not a package manager: it resolves **one** name and range to **one** tarball
 * URL and digest. There is no dependency graph here on purpose — a plugin
 * declares no runtime dependencies (that is what the `silo:api` virtual module
 * buys, §13.3), so resolving a graph would be machinery in service of a case
 * the plugin contract says should not exist. `PluginInstaller` warns when a
 * package brings dependencies anyway rather than quietly installing a tree.
 *
 * Lifecycle scripts are never run, here or anywhere downstream — §13.8 names
 * that as a requirement of any installer, and this class is where an
 * implementation would be tempted to shell out to npm and inherit them.
 */
export class NpmRegistry {
  static readonly Default = "https://registry.npmjs.org";

  constructor(private readonly baseUrl: string = NpmRegistry.Default) {}

  async resolve(name: string, range: string): Promise<ResolvedRelease> {
    const what = `plugin "${name}"`;
    const packument = await this.packument(name, what);

    const version = NpmRegistry.pick(packument, range, what);
    const dist = packument.versions?.[version]?.dist;
    if (!dist || typeof dist.tarball !== "string") {
      throw new Error(`${what}: the registry lists ${version} with no tarball`);
    }

    return {
      version,
      tarball: dist.tarball,
      integrity: NpmRegistry.integrity(dist, `${what}@${version}`),
    };
  }

  /**
   * The abbreviated packument. It is a fraction of the size of the full one
   * and carries everything needed here — versions, dist-tags, `dist` — which
   * matters on a metadata document that for a popular name runs to megabytes.
   */
  private async packument(name: string, what: string): Promise<any> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/${NpmRegistry.encode(name)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/vnd.npm.install-v1+json, application/json" },
      });
    } catch (err: any) {
      throw new Error(`${what}: cannot reach ${url}: ${err.message}`);
    }

    if (response.status === 404) throw new Error(`${what}: no such package on ${this.baseUrl}`);
    if (!response.ok) {
      throw new Error(`${what}: registry answered ${response.status} ${response.statusText}`);
    }
    return await response.json();
  }

  /** A scoped name is one path segment with an encoded slash — `@a/b` is
   *  `@a%2fb`, not two segments. */
  private static encode(name: string): string {
    return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  }

  /** A dist-tag if the spec named one, otherwise the highest version the range
   *  admits. Tags win, which is what makes the default spec (`latest`) work. */
  private static pick(packument: any, range: string, what: string): string {
    const tagged = packument["dist-tags"]?.[range];
    if (typeof tagged === "string") return tagged;

    const versions = Object.keys(packument.versions ?? {});
    if (versions.length === 0) throw new Error(`${what}: the registry lists no versions`);

    const best = semver.maxSatisfying(versions, range);
    if (!best) {
      throw new Error(
        `${what}: no published version satisfies "${range}" ` +
          `(latest is ${packument["dist-tags"]?.latest ?? semver.rsort(versions)[0]})`
      );
    }
    return best;
  }

  /** `dist.integrity` when the publish was recent enough to have one, the
   *  legacy hex `shasum` otherwise. A release with neither is refused rather
   *  than installed unverified — an installer that silently drops its only
   *  check on old packages checks nothing an attacker cannot arrange. */
  private static integrity(dist: any, what: string): string {
    if (typeof dist.integrity === "string" && Integrity.isValid(dist.integrity)) {
      return dist.integrity;
    }
    if (typeof dist.shasum === "string") return Integrity.fromShasum(dist.shasum, what);
    throw new Error(`${what}: the registry publishes no integrity digest for it. Not installing.`);
  }
}
