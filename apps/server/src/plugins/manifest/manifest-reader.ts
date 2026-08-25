import fs from "fs/promises";
import path from "path";
import { ManifestContributionsReader } from "./manifest-contributions-reader";
import { ManifestPermissionsReader } from "./manifest-permissions-reader";
import { VersionRange } from "./version-range";
import type { PluginManifest } from "./plugin-manifest";
import type { ResolvedPlugin } from "./resolved-plugin";

/**
 * Finds a plugin on disk and validates its `package.json#silo` block, without
 * executing anything (D31/§13.2).
 *
 * Every failure here refuses the start rather than skipping the plugin. A
 * silently dropped plugin is the worst outcome available: the instance runs,
 * looks healthy, and quietly stops enforcing whatever the plugin was there to
 * enforce. That is the same instinct D14 applies to an unknown `format_version`
 * and D20 to an invalid default project id.
 *
 * The `contributes`/`permissions` shape (D36) is a **breaking** manifest change,
 * and the four `Retired` keys below are why it can be one safely: a package still
 * carrying `kind`, `hooks`, `routes` or `claims` at the top level is refused by
 * name, with the field that replaced it. The alternative — reading the old keys
 * too — would mean two shapes to keep in step forever, and a package could then
 * ask for a claim with no reason attached simply by using the older spelling.
 */
export class ManifestReader {
  /** Old manifest keys, and what replaced each. Refused rather than ignored: a
   *  manifest whose `claims` block is silently dropped asks for nothing, which is
   *  a plugin that loads and then cannot work. */
  private static readonly Retired: readonly { key: string; instead: string }[] = [
    { key: "kind", instead: '"silo.contributes" — a package is no longer one thing or the other' },
    { key: "hooks", instead: '"silo.contributes.hooks"' },
    { key: "routes", instead: '"silo.contributes.routes"' },
    { key: "provider", instead: '"silo.contributes.providers", which is a list and takes an "entry"' },
    { key: "claims", instead: '"silo.permissions.required" / ".optional", each entry with a "reason"' },
  ];

  /**
   * Resolve `name` under `pluginsDir`, accepting either a plain directory or a
   * `node_modules/<name>` layout.
   *
   * Both are accepted so the installer that arrives later (§12.8) can populate
   * `node_modules/` without any configured instance having to change a line.
   */
  static async read(pluginsDir: string, name: string): Promise<ResolvedPlugin> {
    const dir = await ManifestReader.locate(pluginsDir, name);
    const pkgPath = path.join(dir, "package.json");

    let pkg: any;
    try {
      pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    } catch (caught: any) {
      throw new Error(`plugin "${name}": cannot read ${pkgPath}: ${caught.message}`);
    }

    const manifest = ManifestReader.validate(name, pkg);
    return { manifest, dir, entry: await ManifestReader.entry(name, dir, pkg) };
  }

  private static async locate(pluginsDir: string, name: string): Promise<string> {
    const candidates = [path.join(pluginsDir, name), path.join(pluginsDir, "node_modules", name)];
    for (const candidate of candidates) {
      try {
        if ((await fs.stat(candidate)).isDirectory()) return path.resolve(candidate);
      } catch {
        // Next candidate. A missing directory is not the error to report —
        // "looked in both places" is more useful than "the first one is gone".
      }
    }
    throw new Error(
      `plugin "${name}": not found. Looked in ${candidates.map((c) => `"${c}"`).join(" and ")}.`
    );
  }

  /**
   * The module the host imports. `module` wins over `main` because a plugin is
   * loaded as ESM, and the bare-directory fallbacks exist because a plugin
   * written by hand — which is the whole 1.0 story, since there is no
   * installer — often has no manifest entry point at all.
   */
  private static async entry(name: string, dir: string, pkg: any): Promise<string> {
    const declared = typeof pkg.module === "string" ? pkg.module : typeof pkg.main === "string" ? pkg.main : null;
    const candidates = declared
      ? [path.resolve(dir, declared)]
      : ["index.ts", "index.js", "index.mjs"].map((f) => path.join(dir, f));

    for (const candidate of candidates) {
      try {
        if ((await fs.stat(candidate)).isFile()) return candidate;
      } catch {
        // Try the next one.
      }
    }
    throw new Error(
      `plugin "${name}": no entry module. Set "main" in package.json, or add an index.ts.`
    );
  }

  /** The `silo` block of an already-parsed `package.json`, validated. */
  static validate(name: string, pkg: any): PluginManifest {
    const silo = pkg?.silo;
    if (!silo || typeof silo !== "object") {
      throw new Error(`plugin "${name}": package.json has no "silo" block (D31/§13.2).`);
    }

    if (typeof silo.silo !== "string" || !VersionRange.isValid(silo.silo)) {
      throw new Error(
        `plugin "${name}": "silo.silo" must be a version range this silo understands ` +
          `(e.g. "^1"); got ${JSON.stringify(silo.silo)}.`
      );
    }

    ManifestReader.refuseRetired(name, silo);

    return {
      name: typeof pkg.name === "string" ? pkg.name : name,
      silo: silo.silo,
      contributes: ManifestContributionsReader.read(name, silo.contributes),
      permissions: ManifestPermissionsReader.read(name, silo.permissions),
      config: silo.config,
    };
  }

  /** Name the old key and the new one. A manifest written against the previous
   *  shape is a fixable mistake, and the fix is mechanical — so the refusal says
   *  what to write rather than only that something is wrong. */
  private static refuseRetired(name: string, silo: Record<string, unknown>): void {
    for (const { key, instead } of ManifestReader.Retired) {
      if (silo[key] === undefined) continue;
      throw new Error(
        `plugin "${name}": "silo.${key}" was removed in D36. Use ${instead}.`
      );
    }
  }
}
