import type { PluginRoute } from "../manifest/plugin-route";

/** A declared route, and the parameters the request path bound to it. */
export interface PluginRouteMatch {
  route: PluginRoute;
  params: Record<string, string>;
}
