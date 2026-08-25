import fs from "fs/promises";
import path from "path";
import { HookNames } from "../../core/hooks";
import type { HookName } from "../../core/hooks";
import { ValidationError } from "@silo/shared/validation-error";
import { Claims } from "@silo/shared/claims";
import { VersionRange } from "./version-range";
import type { PluginManifest } from "./plugin-manifest";
import type { PluginRoute } from "./plugin-route";
import { PluginRoutes } from "./plugin-routes";
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

    if (silo.kind !== "extension" && silo.kind !== "provider") {
      throw new Error(`plugin "${name}": "silo.kind" must be "extension" or "provider".`);
    }

    const hooks = ManifestReader.hooks(name, silo.hooks);
    const routes = ManifestReader.routes(name, silo.routes);
    const claims = ManifestReader.claims(name, silo.claims);

    // The question is "would anything ever call this", and since phase 6 there
    // are two ways to be called. Asking only about hooks is what D36 objects to
    // in `kind`: it made a package that wanted to serve a route invent a hook
    // merely to be loaded.
    if (silo.kind === "extension" && hooks.length === 0 && routes.length === 0) {
      throw new Error(
        `plugin "${name}": an extension plugin declares no hooks and no routes, so nothing ` +
          `would ever call it. Declare at least one hook (${HookNames.All.join(", ")}) ` +
          `or one route.`
      );
    }

    const manifest: PluginManifest = {
      name: typeof pkg.name === "string" ? pkg.name : name,
      silo: silo.silo,
      kind: silo.kind,
      hooks,
      routes,
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
   * Validate `silo.routes` (D36, phase 6).
   *
   * Strict about the path grammar, because every rule here is a way a plugin
   * could otherwise reach outside the namespace it was given: `..` climbs out
   * of it, a wildcard claims paths a later silo version may define inside it,
   * and an absolute or scheme-bearing path was never relative at all. Two
   * routes with the same method and path are refused rather than resolved by
   * order, since "which handler ran" would then depend on manifest order alone.
   */
  private static routes(name: string, raw: unknown): PluginRoute[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error(`plugin "${name}": "silo.routes" must be an array.`);

    const routes: PluginRoute[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        throw new Error(`plugin "${name}": every entry in "silo.routes" must be an object.`);
      }
      if (!PluginRoutes.isMethod(entry.method)) {
        throw new Error(
          `plugin "${name}": route method ${JSON.stringify(entry.method)} is not one of ` +
            `${PluginRoutes.Methods.join(", ")}.`
        );
      }
      const auth = entry.auth === undefined ? "key" : entry.auth;
      if (auth !== "key" && auth !== "public") {
        throw new Error(
          `plugin "${name}": route "${entry.method} ${entry.path}" has ` +
            `"auth": ${JSON.stringify(entry.auth)}; it must be "key" or "public".`
        );
      }

      const route: PluginRoute = {
        method: entry.method,
        path: ManifestReader.routePath(name, entry.path),
        auth,
      };
      const key = PluginRoutes.key(route);
      if (seen.has(key)) {
        throw new Error(`plugin "${name}": route "${key}" is declared more than once.`);
      }
      seen.add(key);
      routes.push(route);
    }
    return routes;
  }

  /** One route path, or a refusal naming what is wrong with it. */
  private static routePath(name: string, raw: unknown): string {
    const at = (why: string) =>
      new Error(`plugin "${name}": route path ${JSON.stringify(raw)} ${why}.`);

    if (typeof raw !== "string" || raw.length === 0) throw at("must be a non-empty string");
    if (!raw.startsWith("/")) throw at('must start with "/", and is relative to /api/ext/<name>');
    if (raw.length > 1 && raw.endsWith("/")) throw at('must not end with "/"');
    if (raw.includes("//")) throw at('must not contain an empty segment ("//")');
    if (raw.includes("*")) throw at("must not use a wildcard");
    if (raw.includes("?") || raw.includes("#")) throw at("must not carry a query or a fragment");

    // "/" itself is the plugin's own root and has no segments to check.
    if (raw === "/") return raw;

    for (const segment of raw.slice(1).split("/")) {
      if (segment === "." || segment === "..") throw at(`must not contain "${segment}"`);
      const body = segment.startsWith(":") ? segment.slice(1) : segment;
      if (body.length === 0) throw at("has a parameter with no name");
      if (!/^[A-Za-z0-9._~-]+$/.test(body)) {
        throw at(`has an unusable segment "${segment}"`);
      }
    }
    return raw;
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
    } catch (caught: any) {
      const detail = ValidationError.is(caught) ? caught.message : String(caught?.message ?? caught);
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
