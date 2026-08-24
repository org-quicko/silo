/**
 * `/api/plugins/*` — **reserved, and deliberately empty** (D31/§13.1).
 *
 * Plugin-contributed HTTP routes are not in 1.0. Reserving the namespace is,
 * because reserving costs nothing now and is unavailable later: without it,
 * 1.0 would allow these paths to fall through to the SPA handler, and a 1.x
 * that wanted to mount plugin routes could not tell a genuine plugin route from
 * a client-router path someone had already deep-linked.
 *
 * When routes do arrive, a plugin will mount **under its own name** here and
 * will not be able to escape it. `RouteManager` already documents that its
 * registration order is load-bearing for Hono's matcher; letting third parties
 * into that ordering is how a plugin breaks entry reads by accident.
 */
export class PluginRoutes {
  static register(app: any) {
    app.all("/api/plugins/*", (c: any) =>
      c.json(
        {
          error: {
            code: "not_found",
            message: "plugin routes are not available in this version of silo",
          },
        },
        404
      )
    );
  }
}
