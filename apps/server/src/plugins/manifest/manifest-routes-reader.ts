import type { PluginRoute } from "./plugin-route";
import type { PluginRouteBody } from "./plugin-route-body";
import { PluginRouteBodies } from "./plugin-route-bodies";
import { PluginRoutes } from "./plugin-routes";

/**
 * Validates `silo.contributes.routes` (D36, phase 6).
 *
 * Strict about the path grammar, because every rule here is a way a plugin could
 * otherwise reach outside the namespace it was given: `..` climbs out of it, a
 * wildcard claims paths a later silo version may define inside it, and an
 * absolute or scheme-bearing path was never relative at all. Two routes with the
 * same method and path are refused rather than resolved by order, since "which
 * handler ran" would then depend on manifest order alone.
 *
 * Its own file because the grammar is the longest single validator in the
 * manifest and has nothing to do with the rest of the block.
 */
export class ManifestRoutesReader {
  /** Methods `ExtRequest` reads no body from, so declaring one for them says
   *  nothing that could ever take effect. */
  private static readonly Bodiless: readonly string[] = ["GET"];

  static read(name: string, raw: unknown): PluginRoute[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new Error(`plugin "${name}": "silo.contributes.routes" must be an array.`);
    }

    const routes: PluginRoute[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        throw new Error(
          `plugin "${name}": every entry in "silo.contributes.routes" must be an object.`
        );
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
        path: ManifestRoutesReader.path(name, entry.path),
        auth,
        body: ManifestRoutesReader.body(name, entry),
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

  /**
   * What the route accepts as a body, defaulted to D36's behaviour (D41).
   *
   * Refused on a method that has no body rather than ignored, because the two
   * outcomes are indistinguishable to the author and only one of them is what
   * they meant: a `GET` declaring `bytes` is a mistake about how the route works,
   * and silently accepting it would leave them debugging a handler that is always
   * handed nothing.
   */
  private static body(name: string, entry: any): PluginRouteBody {
    const raw = entry.body;
    const at = (why: string) =>
      new Error(`plugin "${name}": route "${entry.method} ${entry.path}" ${why}.`);

    if (raw === undefined) return PluginRouteBodies.Default;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw at(
        'has a "body" that is not an object; want { "kind": "text" | "bytes", "max_bytes": <n> }'
      );
    }
    if (ManifestRoutesReader.Bodiless.includes(entry.method)) {
      throw at(`declares a "body", but ${entry.method} carries none — remove it`);
    }

    const kind = raw.kind === undefined ? PluginRouteBodies.Default.kind : raw.kind;
    if (!PluginRouteBodies.isKind(kind)) {
      throw at(
        `has "body.kind": ${JSON.stringify(raw.kind)}; it must be one of ` +
          `${PluginRouteBodies.Kinds.join(", ")}`
      );
    }

    const max = raw.max_bytes === undefined ? PluginRouteBodies.DefaultMaxBytes : raw.max_bytes;
    if (typeof max !== "number" || !Number.isInteger(max) || max < 1) {
      throw at(
        `has "body.max_bytes": ${JSON.stringify(raw.max_bytes)}; it must be a positive integer`
      );
    }
    if (max > PluginRouteBodies.Ceiling) {
      throw at(
        `asks for a ${PluginRouteBodies.size(max)} body; silo accepts at most ` +
          `${PluginRouteBodies.size(PluginRouteBodies.Ceiling)} on a plugin route, because the ` +
          `body crosses to the worker as one value and there is no back-pressure to be had`
      );
    }
    return { kind, max_bytes: max };
  }

  /** One route path, or a refusal naming what is wrong with it. */
  private static path(name: string, raw: unknown): string {
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
}
