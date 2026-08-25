/** The HTTP methods a plugin route may claim. */
export type PluginRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Who may reach a plugin route.
 *
 * `key` — any authenticated key. `public` — no credential at all, which is a
 * separate decision and not a lesser one: see `PluginRoute.auth`.
 */
export type PluginRouteAuth = "key" | "public";

/**
 * One route a plugin declares, statically, in `package.json#silo` (D36, phase
 * 6).
 *
 * Declared rather than registered, for the reason §13.2 gives about the whole
 * manifest: `silo plugin info` has to show an operator what a package will
 * expose **before** any of its code runs, and a route list that only existed
 * after `activate()` could not be approved in advance. It is also what keeps
 * plugins out of Hono's matcher — silo matches against this list itself, so a
 * plugin cannot register a pattern that shadows `/api/projects`.
 */
export interface PluginRoute {
  method: PluginRouteMethod;

  /**
   * The path **within** the plugin's namespace, so `/status` is served at
   * `/api/ext/{name}/status`.
   *
   * Relative because the prefix is not the plugin's to choose. A route may name
   * parameters as `:id` segments and may not use wildcards: a plugin that could
   * write `/*` would claim every path its own namespace will ever have,
   * including ones a later silo version gives a meaning.
   */
  path: string;

  /**
   * Whether a caller needs a key.
   *
   * `key` is the default because it is the weaker grant of the two, and
   * `public` is called out in the record and on the grant screen because it is
   * the one property of a route that an operator cannot infer from the rest:
   * **a handler runs with the plugin's authority, not the caller's**, so a
   * public route publishes whatever the plugin was granted at a URL anyone can
   * reach. That is the confused-deputy hazard, and it is why the route list is
   * part of the approval rather than a detail of the package.
   */
  auth: PluginRouteAuth;
}
