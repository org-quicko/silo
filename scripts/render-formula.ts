import { parseArgs } from "util";
import fs from "fs/promises";

/**
 * Renders the Homebrew formula for a release.
 *
 * The formula's only job is to name four URLs and the checksum of each, so the
 * release workflow could in principle rewrite it with `sed`. It does not,
 * because a formula whose checksums are wrong installs a binary nobody vouched
 * for, and a `sed` that silently matches nothing produces exactly that. Every
 * placeholder here must be filled from a checksum that was actually present in
 * `SHA256SUMS`, or the render fails and no tap commit happens.
 *
 *   bun run scripts/render-formula.ts --version 1.2.3 \
 *     --checksums SHA256SUMS --out Formula/silo.rb
 */
export class RenderFormula {
  private static readonly template = "packaging/homebrew/silo.rb.tmpl";

  /** `<sha256>  silo-1.2.3-linux-x64.tar.gz`, as `sha256sum` writes it. */
  private static readonly checksumLine = /^([0-9a-f]{64})\s+\*?(\S+)$/;

  static async run(): Promise<void> {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        version: { type: "string" },
        checksums: { type: "string" },
        out: { type: "string" },
      },
      strict: true,
    });

    for (const [flag, value] of Object.entries(values)) {
      if (!value) throw new Error(`--${flag} is required`);
    }

    const checksums = RenderFormula.parseChecksums(
      await fs.readFile(values.checksums!, "utf8"),
      values.version!
    );

    const rendered = RenderFormula.render(
      await fs.readFile(RenderFormula.template, "utf8"),
      values.version!,
      checksums
    );

    await Bun.write(values.out!, rendered);
    console.log(`${values.out}  silo ${values.version}  (${[...checksums.keys()].sort().join(", ")})`);
  }

  /**
   * Reads `SHA256SUMS` into a map keyed by target — `linux-x64` from
   * `silo-1.2.3-linux-x64.tar.gz`.
   *
   * Keying off the filename rather than the order of the lines is what lets the
   * build matrix change shape without silently mis-assigning a checksum to the
   * wrong architecture, which is a mistake no user could detect and every user
   * would hit.
   */
  private static parseChecksums(contents: string, version: string): Map<string, string> {
    const prefix = `silo-${version}-`;
    const suffix = ".tar.gz";
    const checksums = new Map<string, string>();

    for (const line of contents.split("\n")) {
      const match = RenderFormula.checksumLine.exec(line.trim());
      if (!match) continue;

      const [, sha, filename] = match;
      if (!filename!.startsWith(prefix) || !filename!.endsWith(suffix)) continue;
      checksums.set(filename!.slice(prefix.length, -suffix.length), sha!);
    }

    if (checksums.size === 0) {
      throw new Error(`no checksums for silo ${version} in the checksum file`);
    }
    return checksums;
  }

  private static render(template: string, version: string, checksums: Map<string, string>): string {
    const missing: string[] = [];

    const rendered = template
      .replaceAll("{{version}}", version)
      .replaceAll(/\{\{sha256:([a-z0-9-]+)\}\}/g, (_, target: string) => {
        const sha = checksums.get(target);
        if (!sha) missing.push(target);
        return sha ?? "";
      });

    if (missing.length > 0) {
      throw new Error(`no checksum for ${missing.join(", ")} — release artifacts are incomplete`);
    }

    const leftover = /\{\{[^}]+\}\}/.exec(rendered);
    if (leftover) throw new Error(`unfilled placeholder ${leftover[0]} in the formula template`);

    return rendered;
  }
}

await RenderFormula.run();
