import { readFileSync } from "fs";

/** What a connection asks of TLS, named as `sslmode` names it. */
export type PgTlsMode = "disable" | "require" | "verify-ca" | "verify-full";

/**
 * The TLS half of `[storage] url`, read the way libpq reads it, because a
 * hosting provider hands out a libpq URL (docs/design/storage.md §6.6).
 *
 * Bun reads `sslmode` but not the files libpq names beside it, and it sends a
 * query parameter it does not know to the server, which refuses the
 * connection. So silo takes the TLS parameters out of the URL and gives the
 * driver its own options:
 *
 * - `sslmode`: `disable` (the default), `require`, `verify-ca` or
 *   `verify-full`. `prefer` and `allow` are refused, because Bun 1.4 waits
 *   out the connect timeout on a server without TLS instead of falling back.
 * - `sslrootcert`: the CA file to verify the server with, or `system` for the
 *   driver's own roots. With no mode it means `verify-full`, and with
 *   `require` it means `verify-ca`, as in libpq.
 * - `sslcert` and `sslkey`: a client certificate and its key, given together.
 *
 * Any other `ssl` parameter is refused, so the URL never asks for something
 * that is then ignored.
 */
export class PgTls {
  private static readonly Modes: readonly string[] = ["disable", "require", "verify-ca", "verify-full"];
  private static readonly Handled = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey"]);

  readonly mode: PgTlsMode;
  /** The URL the driver is given: the TLS parameters out, and `sslmode` set. */
  readonly url: string;
  /** The driver's `tls` option, when the URL names files. Absent, the driver uses its own roots. */
  readonly files: { ca?: string; cert?: string; key?: string } | undefined;

  private constructor(mode: PgTlsMode, url: string, files: PgTls["files"]) {
    this.mode = mode;
    this.url = url;
    this.files = files;
  }

  /** Reads the TLS parameters from `url`, and the files they name. */
  static of(url: string): PgTls {
    const at = url.indexOf("?");
    const base = at < 0 ? url : url.slice(0, at);
    const kept: string[] = [];
    const asked = new Map<string, string>();
    for (const pair of at < 0 ? [] : url.slice(at + 1).split("&")) {
      if (pair === "") continue;
      const split = pair.indexOf("=");
      const name = PgTls.decode(split < 0 ? pair : pair.slice(0, split));
      if (PgTls.Handled.has(name)) asked.set(name, PgTls.decode(split < 0 ? "" : pair.slice(split + 1)));
      else if (name.startsWith("ssl") || name === "requiressl") throw PgTls.refused(`${name} is not supported`);
      else kept.push(pair);
    }

    const mode = PgTls.modeOf(asked);
    const root = asked.get("sslrootcert");
    const cert = asked.get("sslcert");
    const files: NonNullable<PgTls["files"]> = {};
    if (root !== undefined && root !== "system") files.ca = PgTls.read("sslrootcert", root);
    if (cert !== undefined) {
      files.cert = PgTls.read("sslcert", cert);
      files.key = PgTls.read("sslkey", asked.get("sslkey")!);
    }
    const query = [...kept, `sslmode=${mode}`].join("&");
    return new PgTls(mode, `${base}?${query}`, Object.keys(files).length > 0 ? files : undefined);
  }

  private static modeOf(asked: Map<string, string>): PgTlsMode {
    const named = asked.get("sslmode");
    const root = asked.get("sslrootcert");
    const cert = asked.get("sslcert");
    if ((cert === undefined) !== (asked.get("sslkey") === undefined)) {
      throw PgTls.refused("sslcert and sslkey name a client certificate and its key, so give both");
    }
    if (named === "prefer" || named === "allow") {
      throw PgTls.refused(
        `sslmode=${named} is not supported: against a server without TLS the driver waits out the connect timeout rather than falling back. Use verify-full, verify-ca or require, or disable`
      );
    }
    if (named !== undefined && !PgTls.Modes.includes(named)) {
      throw PgTls.refused(`sslmode=${named} is not a mode; use disable, require, verify-ca or verify-full`);
    }

    let mode = (named ?? (root !== undefined ? "verify-full" : cert !== undefined ? "require" : "disable")) as PgTlsMode;
    if (mode === "disable" && (root !== undefined || cert !== undefined)) {
      throw PgTls.refused("sslmode=disable turns TLS off, so the certificates named beside it would be ignored");
    }
    if (root === "system" && mode !== "verify-full") {
      throw PgTls.refused(`sslrootcert=system checks the server's name as well, so it needs sslmode=verify-full, not ${mode}`);
    }
    // libpq's rule: `require` with a CA to check against checks the chain.
    if (root !== undefined && mode === "require") mode = "verify-ca";
    return mode;
  }

  /** A certificate or key file, which must be PEM. */
  private static read(parameter: string, path: string): string {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      const code = (error as { code?: string }).code ?? "unreadable";
      throw PgTls.refused(`${parameter}=${path} cannot be read (${code})`);
    }
    if (!text.includes("-----BEGIN ")) throw PgTls.refused(`${parameter}=${path} is not a PEM file`);
    return text;
  }

  private static decode(text: string): string {
    try {
      return decodeURIComponent(text);
    } catch {
      throw PgTls.refused("a query parameter is not valid percent-encoding");
    }
  }

  private static refused(reason: string): Error {
    return new Error(`[storage] url: ${reason}`);
  }
}
