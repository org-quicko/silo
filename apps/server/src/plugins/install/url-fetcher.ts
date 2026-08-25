import path from "path";
import { Integrity } from "./integrity";
import { PackageExtractor } from "./package-extractor";
import { TarballDownload } from "./tarball-download";
import type { FetchedPackage, PackageFetcher } from "./package-fetcher";

/**
 * `silo add https://…/silo-plugin-slug.tgz` — a tarball at a URL (D32).
 *
 * The weakest source, and the only one where the operator has to supply the
 * check themselves: there is no metadata document to compare against, so
 * `--integrity sha512-…` is the whole verification story. Without it silo has
 * only TLS, which authenticates the *host* and not the file — a compromised
 * build server serves a bad tarball over a perfectly valid certificate.
 *
 * It is not refused for lack of a digest, because the release-asset case is
 * real and the alternative is the operator downloading it by hand and losing
 * the check entirely. It warns, and the lockfile records what did arrive, so
 * the *second* install of the same URL is verified against the first.
 */
export class UrlFetcher implements PackageFetcher {
  private readonly expected: string | undefined;

  /**
   * The digest is validated **here**, on presence rather than truthiness, and
   * exactly once.
   *
   * Doing it inside `fetch` behind `if (this.expected)` let an empty string —
   * `--integrity "$UNSET_VAR"` in a CI script, or a bare `--integrity=` —
   * through three gates at once: falsy here so it was never rejected as a
   * malformed digest, falsy again in `TarballDownload` so nothing was ever
   * compared, and `!== undefined` in `verified` so the warning that exists to
   * announce an unverified download was suppressed as well. An empty digest was
   * therefore *quieter* than no digest at all, and recorded `""` in the lockfile
   * instead of the computed pin — the exact opposite of what the one flag that
   * says "check this" should do when it is malformed.
   *
   * One normalised field settles it: past this constructor `expected` is either
   * absent or a digest, so every downstream reading of it agrees.
   */
  constructor(private readonly url: string, expected?: string) {
    if (expected !== undefined && !Integrity.isValid(expected)) {
      throw new Error(
        `plugin at ${url}: --integrity "${expected}" is not a digest (expected "sha512-<base64>")`
      );
    }
    this.expected = expected;
  }

  async fetch(staging: string): Promise<FetchedPackage> {
    const what = `plugin at ${this.url}`;
    const file = path.join(staging, "package.tgz");
    const bytes = await TarballDownload.to(file, this.url, this.expected, what);

    const into = path.join(staging, "package");
    await PackageExtractor.extract(file, into, what);

    return {
      dir: await PackageExtractor.packageRoot(into, what),
      resolved: this.url,
      // Computed when none was given, so it is at least pinned from here on.
      // `??` is sound because the constructor has already ruled out an
      // `expected` that is present but unusable.
      integrity: this.expected ?? Integrity.compute(bytes),
    };
  }

  /** Whether this install was verified against something the operator knew in
   *  advance, as opposed to merely recorded. Drives the warning `silo add`
   *  prints, which is the only place the difference is visible. */
  get verified(): boolean {
    return this.expected !== undefined;
  }
}
