import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RouteInventory } from "../../src/transport/route-inventory";

/**
 * `RouteInventory` against the server's own route registrations.
 *
 * Deliberately not against `docs/guide/http-api.md`: that document was missing
 * three media routes and an error code when this package was written, and a
 * drift guard reading something that can be incomplete is false confidence.
 *
 * Skips when `apps/server` is absent, so the package still tests standalone.
 */

const HttpDirectory = join(import.meta.dir, "../../../../apps/server/src/http");
const RoutesDirectory = join(HttpDirectory, "routes");
/** `/api/health` and the UI assets are registered in `server.ts` itself, not
 * under `routes/`, so the scan reads both. */
const ServerFiles = ["server.ts"];
const ServerPresent = existsSync(RoutesDirectory);

/**
 * Registrations this scanner cannot resolve, and what each one produces.
 *
 * `plugin-routes.ts` registers enable and disable from a loop over a verb, so
 * the path is a template literal with a binding in it. Listing the site here
 * rather than teaching the scanner about loops keeps the scanner simple, and
 * the assertion below still fails if a *new* file starts doing it — which is
 * the property that matters, since an unnoticed registration style is exactly
 * how a route would slip past this test.
 */
const UnparsedRegistrations: Readonly<Record<string, readonly string[]>> = {
  "plugin-routes.ts": ["POST /api/plugins/:name/enable", "POST /api/plugins/:name/disable"],
};

class ServerRoutes {
  private static readonly Methods = "all|get|post|put|patch|delete";

  /** Every route the server registers, as `METHOD /path`, `/envs` spelling. */
  static scan(): Set<string> {
    const routes = new Set<string>();
    for (const [file, path] of ServerRoutes.sources()) {
      const source = readFileSync(path, "utf8");
      for (const route of ServerRoutes.literals(source)) routes.add(route);
      for (const route of ServerRoutes.throughBothHelper(source)) routes.add(route);
      for (const route of UnparsedRegistrations[file] ?? []) routes.add(route);
    }
    return routes;
  }

  /** Every file that registers a route: `routes/` plus `server.ts`. */
  static sources(): [string, string][] {
    const files: [string, string][] = readdirSync(RoutesDirectory)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => [name, join(RoutesDirectory, name)]);
    for (const name of ServerFiles) files.push([name, join(HttpDirectory, name)]);
    return files;
  }

  /** `app.get("/api/...")` and its siblings. */
  private static literals(source: string): string[] {
    const pattern = new RegExp(`app\\.(${ServerRoutes.Methods})\\(\\s*"([^"]+)"`, "g");
    return [...source.matchAll(pattern)]
      .filter((match) => ServerRoutes.isApiPath(match[2]!))
      .map((match) => ServerRoutes.normalize(match[1]!, match[2]!));
  }

  /**
   * `VariablesRoutes.both(app, "put", "/:name",...)`, whose base templates
   * are the `app[method](\`...\`)` lines inside the helper itself.
   */
  private static throughBothHelper(source: string): string[] {
    const bases = [...source.matchAll(/app\[method\]\(`([^`]+)`/g)]
      .map((match) => match[1]!)
      .filter((base) => base.includes("${suffix}"));
    if (bases.length === 0) return [];

    const calls = [...source.matchAll(/\.both\(\s*app,\s*"([a-z]+)",\s*"([^"]*)"/g)];
    const routes: string[] = [];
    for (const call of calls) {
      for (const base of bases) {
        const path = base.replace("${suffix}", call[2]!);
        if (ServerRoutes.isApiPath(path)) routes.push(ServerRoutes.normalize(call[1]!, path));
      }
    }
    return routes;
  }

  /** Any registration whose path is a template literal this scanner ignores. */
  static templateSites(source: string): string[] {
    const pattern = new RegExp(`app\\.(${ServerRoutes.Methods})\\(\\s*\``, "g");
    return [...source.matchAll(pattern)].map((match) => match[1]!);
  }

  private static isApiPath(path: string): boolean {
    return path.startsWith("/api/") || path.startsWith("/media/");
  }

  /** The server registers `/environments/` and `/envs/`; the client uses the
   * second, so both spellings collapse onto it. */
  private static normalize(method: string, path: string): string {
    return `${method.toUpperCase()} ${path.replace("/environments", "/envs")}`;
  }
}

describe.skipIf(!ServerPresent)("RouteInventory against the server", () => {
  test("accounts for every route the server registers", () => {
    const unaccounted = [...ServerRoutes.scan()].filter((route) => !RouteInventory.accountsFor(route));
    expect(unaccounted).toEqual([]);
  });

  test("covers no route the server does not register", () => {
    const registered = ServerRoutes.scan();
    const stale = RouteInventory.Covered.filter((route) => !registered.has(route));
    expect(stale).toEqual([]);
  });

  test("names a reason for every route it leaves out", () => {
    const unexplained = Object.entries(RouteInventory.OutOfScope)
      .filter(([, reason]) => reason.trim() === "")
      .map(([route]) => route);
    expect(unexplained).toEqual([]);
  });

  test("has no route in both lists", () => {
    const both = RouteInventory.Covered.filter((route) => route in RouteInventory.OutOfScope);
    expect(both).toEqual([]);
  });

  test("no unlisted file registers a route this scanner cannot read", () => {
    const surprises: string[] = [];
    for (const [file, path] of ServerRoutes.sources()) {
      const source = readFileSync(path, "utf8");
      const usesTemplate = ServerRoutes.templateSites(source).length > 0;
      if (usesTemplate && !(file in UnparsedRegistrations)) surprises.push(file);
    }
    expect(surprises).toEqual([]);
  });
});
