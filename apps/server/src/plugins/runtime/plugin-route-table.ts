import type { PluginRoute } from "../manifest/plugin-route";
import type { PluginRouteMatch } from "./plugin-route-match";

/**
 * Matches a request against one plugin's declared routes (D36, phase 6).
 *
 * silo's own matcher rather than Hono's, and that is the point rather than a
 * limitation. `RouteManager` documents that registration order is load-bearing
 * for Hono's router — `/schema` before `/:id`, `/search` before entries — so
 * letting third parties register patterns into that order is how a plugin
 * breaks entry reads by accident. Matching here means a plugin's routes are
 * data the host interprets: they cannot shadow a silo route, cannot reorder
 * one, and can be **added and removed while the process runs**, which is what
 * keeps phase 4's enable, disable, revoke and rescan meaning the same thing for
 * routes as they already do for hooks.
 *
 * The grammar is deliberately smaller than Hono's: literal segments and `:name`
 * parameters, no wildcards, no optional segments, no regular expressions. A
 * plugin that needed those would be asking to own a subtree rather than a set
 * of paths, and `ManifestReader` refuses them at the manifest so the refusal
 * names the package.
 */
export class PluginRouteTable {
  private readonly routes: readonly PluginRoute[];

  constructor(routes: readonly PluginRoute[]) {
    this.routes = routes;
  }

  get empty(): boolean {
    return this.routes.length === 0;
  }

  /**
   * The route for one method and path, or why there is none.
   *
   * `"method"` — the path matched a declared route under a *different* method,
   * which is a 405 and not a 404: telling a caller the path does not exist when
   * it does, and is merely spelled `POST`, is the kind of answer that sends
   * someone reading a manifest looking for a typo.
   */
  match(method: string, path: string): PluginRouteMatch | "method" | null {
    const wanted = PluginRouteTable.segments(path);
    // HEAD is GET without content (RFC 9110 §9.3.2), so a declared GET answers
    // it. Not a courtesy: every silo route already does, and a plugin route that
    // did not would be the one route on the instance where a cache, a proxy or
    // an uptime check gets a 405 — from callers no plugin author is testing
    // with. `ExtRoutes` drops the body.
    const wantedMethod = method === "HEAD" ? "GET" : method;
    let pathMatched = false;

    for (const route of this.routes) {
      const params = PluginRouteTable.bind(route.path, wanted);
      if (!params) continue;
      pathMatched = true;
      if (route.method === wantedMethod) return { route, params };
    }
    return pathMatched ? "method" : null;
  }

  /**
   * Bind one declared path against a request's segments, or `null`.
   *
   * A parameter never matches an empty segment, so `/items/` does not satisfy
   * `/items/:id` with an empty id — a plugin reading `params.id` would
   * otherwise get `""` for a request that named nothing.
   */
  private static bind(
    declared: string,
    wanted: readonly string[]
  ): Record<string, string> | null {
    const parts = PluginRouteTable.segments(declared);
    if (parts.length !== wanted.length) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const value = wanted[i]!;
      if (part.startsWith(":")) {
        if (value.length === 0) return null;
        params[part.slice(1)] = value;
        continue;
      }
      if (part !== value) return null;
    }
    return params;
  }

  /**
   * Path to segments, with the percent-encoding undone **after** splitting.
   *
   * Order matters: decoding first would let `%2F` in a parameter become a
   * separator and let one segment match two, which is the classic way a path
   * parameter escapes its position.
   */
  private static segments(path: string): string[] {
    const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
    if (trimmed.length === 0) return [];
    return trimmed.split("/").map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        // A malformed escape is not a reason to fail the request here; it simply
        // is not equal to anything a manifest can declare.
        return segment;
      }
    });
  }
}
