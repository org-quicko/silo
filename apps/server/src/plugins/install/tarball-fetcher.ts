import fs from "fs/promises";
import path from "path";
import { Integrity } from "./integrity";
import { PackageExtractor } from "./package-extractor";
import type { FetchedPackage, PackageFetcher } from "./package-fetcher";

/**
 * `silo add ./silo-plugin-slug-1.2.0.tgz` — a package file already on disk
 * (D32).
 *
 * A digest is always *computed*, so the lockfile records what was installed and
 * a second machine given the same tarball can prove it got the same one. When
 * the operator also passes `--integrity` it is *checked* — the case where they
 * downloaded a release by hand and have the publisher's digest from somewhere
 * else, which is the only thing that makes a file handed over out of band any
 * better than a file fetched over plain http.
 */
export class TarballFetcher implements PackageFetcher {
  constructor(private readonly source: string, private readonly expected?: string) {}

  async fetch(staging: string): Promise<FetchedPackage> {
    const file = path.resolve(this.source);
    const what = `plugin tarball "${file}"`;

    let bytes: Buffer;
    try {
      bytes = await fs.readFile(file);
    } catch (error: any) {
      throw new Error(`${what}: cannot read it: ${error.message}`);
    }

    // Before unpacking, like every other source: a digest checked after the
    // files exist is a report, not a gate.
    if (this.expected !== undefined) Integrity.verify(bytes, this.expected, what);

    const into = path.join(staging, "package");
    await PackageExtractor.extract(file, into, what);

    return {
      dir: await PackageExtractor.packageRoot(into, what),
      resolved: file,
      integrity: Integrity.compute(bytes),
    };
  }
}
