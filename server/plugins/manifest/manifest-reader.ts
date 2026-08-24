import fs from "fs/promises";
import path from "path";
import { HookNames } from "../../core/hooks";
import type { HookName } from "../../core/hooks";
import { ValidationError } from "@silo/shared/validation-error";
import { Claims } from "@silo/shared/claims";
import { VersionRange } from "./version-range";
import type { PluginManifest } from "./plugin-manifest";
import type { ProviderPort } from "./provider-port";
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
 */
export class ManifestReader {
  private static readonly ports: readonly ProviderPort[] = ["storage", "blob"];

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
    } catch (err: any) {
      throw new Error(`plugin "${name}": cannot read ${pkgPath}: ${err.message}`);
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

    if (silo.kind !== "extension" && silo.kind !== "provider") {
      throw new Error(`plugin "${name}": "silo.kind" must be "extension" or "provider".`);
    }

    const hooks = ManifestReader.hooks(name, silo.hooks);
    const claims = ManifestReader.claims(name, silo.claims);

    if (silo.kind === "extension" && hooks.length === 0) {
      throw new Error(
        `plugin "${name}": an extension plugin declares no hooks, so nothing would ever ` +
          `call it. Declare at least one of: ${HookNames.All.join(", ")}.`
      );
    }

    const manifest: PluginManifest = {
      name: typeof pkg.name === "string" ? pkg.name : name,
      silo: silo.silo,
      kind: silo.kind,
      hooks,
      claims,
      config: silo.config,
    };

    if (silo.kind === "provider") {
      manifest.provider = ManifestReader.provider(name, silo.provider);
    }
    return manifest;
  }

  private static hooks(name: string, raw: unknown): HookName[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error(`plugin "${name}": "silo.hooks" must be an array.`);
    for (const hook of raw) {
      if (!HookNames.isHookName(hook)) {
        throw new Error(
          `plugin "${name}": unknown hook ${JSON.stringify(hook)}. ` +
            `Known hooks: ${HookNames.All.join(", ")}.`
        );
      }
    }
    return raw as HookName[];
  }

  /**
   * Claims are validated here rather than only where they are enforced, so a
   * typo is a refused start naming the plugin, not a permission that silently
   * never matches anything at request time.
   */
  private static claims(name: string, raw: unknown): string[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error(`plugin "${name}": "silo.claims" must be an array.`);
    try {
      // normalize is the validator: it rejects anything `isValid` does not
      // recognise, dedupes, and collapses a set containing root to just root.
      return Claims.normalize(raw);
    } catch (err: any) {
      const detail = ValidationError.is(err) ? err.message : String(err?.message ?? err);
      throw new Error(`plugin "${name}": invalid claim in "silo.claims": ${detail}`);
    }
  }

  private static provider(name: string, raw: any): { port: ProviderPort; driver: string } {
    if (!raw || typeof raw !== "object") {
      throw new Error(`plugin "${name}": a provider plugin needs a "silo.provider" block.`);
    }
    if (!ManifestReader.ports.includes(raw.port)) {
      throw new Error(
        `plugin "${name}": "silo.provider.port" must be one of ${ManifestReader.ports.join(", ")}.`
      );
    }
    if (typeof raw.driver !== "string" || raw.driver.length === 0) {
      throw new Error(`plugin "${name}": "silo.provider.driver" must be a non-empty string.`);
    }
    return { port: raw.port, driver: raw.driver };
  }
}
