import type { PluginRoute, PluginRouteMethod } from "./plugin-route";

/**
 * The `PluginRoute` vocabulary, as values — the counterpart to `HookNames`.
 *
 * The **key** is the load-bearing part. A plugin implements a route as a
 * property on the same default export that carries its hooks, named exactly as
 * the manifest declares it: `"GET /status"`. One string names the declaration
 * and the implementation, so `WorkerHost.reconcile` can refuse a declared route
 * with no handler using the check it already applies to hooks — and an operator
 * reading the manifest is reading the function names.
 */
export class PluginRoutes {
  static readonly Methods: readonly PluginRouteMethod[] = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
  ];

  static isMethod(value: unknown): value is PluginRouteMethod {
    return (
      typeof value === "string" && (PluginRoutes.Methods as readonly string[]).includes(value)
    );
  }

  /** How a route is named in the manifest, in the module, and in a log line. */
  static key(route: PluginRoute): string {
    return `${route.method} ${route.path}`;
  }

  static keys(routes: readonly PluginRoute[]): string[] {
    return routes.map((route) => PluginRoutes.key(route));
  }
}
