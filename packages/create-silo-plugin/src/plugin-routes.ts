/** One route this scaffolder will declare, in the shape the manifest takes. */
export interface ScaffoldRoute {
  method: RouteMethod;
  path: string;
  /** Present only when the author asked for a byte body — an absent `body` is
   *  silo's default (text, one mebibyte), and writing that out would be a key an
   *  operator reads and then discards. */
  body?: { kind: "bytes"; max_bytes: number };
}

export type RouteMethod = (typeof ScaffoldRoutes.Methods)[number];

/**
 * The `--routes` grammar, and silo's route rules as far as this tool copies them
 * (§13.18, D41).
 *
 * Copied rather than imported, like everything else in `PluginContract`, and
 * drift-tested against silo's own `PluginRoutes` and `PluginRouteBodies` for the
 * same reason: a scaffold that emits a route silo refuses is worse than no
 * scaffold, because the author has already written the handler.
 */
export class ScaffoldRoutes {
  /** §13.18. Silo's five, in the order a person reads them. */
  static readonly Methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

  /** D41's ceiling, in bytes. A manifest asking past it refuses the start, so
   *  this refuses it while the author is still at the keyboard. */
  static readonly MaxBodyMib = 64;

  /** What a route that says nothing about its body gets. */
  static readonly DefaultBodyBytes = 1024 * 1024;

  /**
   * `"GET /status,POST /source+bytes:64"` → two routes, the second taking a
   * 64 MiB byte body.
   *
   * `+bytes` rather than a second flag, because the two facts belong to one
   * route and a parallel `--body` list would have to be positionally matched to
   * this one — which is a grammar where a dropped comma silently moves a 64 MiB
   * upload cap onto a different route.
   */
  static parse(value: string): ScaffoldRoute[] {
    const routes: ScaffoldRoute[] = [];
    const seen = new Set<string>();

    for (const part of value.split(",").map((each) => each.trim()).filter(Boolean)) {
      const route = ScaffoldRoutes.one(part);
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) {
        throw new Error(`--routes names "${key}" twice; silo refuses a duplicate route.`);
      }
      seen.add(key);
      routes.push(route);
    }
    return routes;
  }

  private static one(part: string): ScaffoldRoute {
    const [spec, ...rest] = part.split("+");
    const words = spec!.trim().split(/\s+/);
    if (words.length !== 2) {
      throw new Error(
        `--routes wants "<METHOD> </path>" per entry, e.g. "GET /status" — got "${part}".`
      );
    }

    const method = words[0]!.toUpperCase();
    if (!ScaffoldRoutes.isMethod(method)) {
      throw new Error(
        `--routes: "${method}" is not one of ${ScaffoldRoutes.Methods.join(", ")}.`
      );
    }

    const route: ScaffoldRoute = { method, path: ScaffoldRoutes.path(words[1]!) };
    const body = rest.join("+").trim();
    if (body.length > 0) route.body = ScaffoldRoutes.body(method, body, route.path);
    return route;
  }

  /**
   * Silo's path grammar, minus nothing that matters.
   *
   * Every rule here is a way a route could otherwise reach outside the namespace
   * it was given, and `ManifestRoutesReader` enforces all of them — so an author
   * who gets one wrong should hear it now rather than at a refused start.
   */
  private static path(raw: string): string {
    const at = (why: string) => new Error(`--routes: path "${raw}" ${why}.`);
    if (!raw.startsWith("/")) throw at('must start with "/" — it is relative to /api/ext/<name>');
    if (raw.length > 1 && raw.endsWith("/")) throw at('must not end with "/"');
    if (raw.includes("//")) throw at('must not contain an empty segment ("//")');
    if (raw.includes("*")) throw at("must not use a wildcard");
    if (raw.includes("?") || raw.includes("#")) throw at("must not carry a query or a fragment");
    if (raw === "/") return raw;

    for (const segment of raw.slice(1).split("/")) {
      const body = segment.startsWith(":") ? segment.slice(1) : segment;
      if (body.length === 0) throw at("has a parameter with no name");
      if (!/^[A-Za-z0-9._~-]+$/.test(body)) throw at(`has an unusable segment "${segment}"`);
    }
    return raw;
  }

  /** `bytes` or `bytes:32`. Anything else is refused rather than defaulted: a
   *  `+text` that silently meant `+bytes` is the mistake worth catching. */
  private static body(
    method: RouteMethod,
    raw: string,
    path: string
  ): { kind: "bytes"; max_bytes: number } {
    const [kind, size] = raw.split(":")
    if (kind !== "bytes") {
      throw new Error(
        `--routes: "${raw}" on "${method} ${path}" is not understood. The only body option is ` +
          `"+bytes" or "+bytes:<MiB>"; a route that says nothing gets text, up to 1 MiB.`
      );
    }
    if (method === "GET") {
      throw new Error(
        `--routes: "${method} ${path}" cannot take a body — GET carries none, and silo refuses ` +
          `a manifest that declares one for it.`
      );
    }

    const mib = size === undefined ? ScaffoldRoutes.MaxBodyMib : Number(size);
    if (!Number.isInteger(mib) || mib < 1 || mib > ScaffoldRoutes.MaxBodyMib) {
      throw new Error(
        `--routes: "+bytes:${size}" on "${method} ${path}" wants a whole number of MiB, ` +
          `1 to ${ScaffoldRoutes.MaxBodyMib}.`
      );
    }
    return { kind: "bytes", max_bytes: mib * 1024 * 1024 };
  }

  static isMethod(value: string): value is RouteMethod {
    return (ScaffoldRoutes.Methods as readonly string[]).includes(value);
  }

  /** How a route is named in the manifest and as the function that serves it. */
  static key(route: ScaffoldRoute): string {
    return `${route.method} ${route.path}`;
  }
}
