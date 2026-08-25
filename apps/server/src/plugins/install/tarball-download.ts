import fs from "fs/promises";
import path from "path";
import { Integrity } from "./integrity";

/**
 * Fetching a tarball over HTTPS and checking it before it is unpacked (D32).
 *
 * Shared by `NpmFetcher` and `UrlFetcher` because the order of operations is
 * the whole point and must not differ between them: download to memory, verify
 * the digest, *then* write. Verifying after unpacking would mean a rejected
 * package had already had its files created, and streaming to disk to save the
 * copy would trade the one property this exists for against a plugin-sized
 * buffer.
 */
export class TarballDownload {
  /** Bounded before the digest is even looked at, because an unbounded body is
   *  a memory problem no hash check can undo. */
  private static readonly MaxBytes = 64 * 1024 * 1024;

  static async to(file: string, url: string, expected: string | undefined, what: string): Promise<Uint8Array> {
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(url)) {
      throw new Error(
        `${what}: refusing to download over plain http — ${url}. ` +
          `Use https, or fetch the tarball yourself and pass the file.`
      );
    }

    let response: Response;
    try {
      response = await fetch(url, { redirect: "follow" });
    } catch (error: any) {
      throw new Error(`${what}: cannot download ${url}: ${error.message}`);
    }
    if (!response.ok) {
      throw new Error(`${what}: ${url} answered ${response.status} ${response.statusText}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error(`${what}: ${url} returned an empty body`);
    if (bytes.byteLength > TarballDownload.MaxBytes) {
      throw new Error(
        `${what}: ${url} is larger than ${TarballDownload.MaxBytes / (1024 * 1024)} MB — not a plugin`
      );
    }

    // Presence, not truthiness. `if (expected)` here would skip verification
    // for an empty string and — because `Integrity.verify` rejects one
    // explicitly — make that rejection unreachable, which is how an empty
    // `--integrity` came to disable the check silently. A caller that has
    // nothing to compare against passes `undefined` and says so.
    if (expected !== undefined) Integrity.verify(bytes, expected, what);

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    return bytes;
  }
}
