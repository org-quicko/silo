/**
 * `/api/ext/*` — **reserved for plugin-contributed routes, and empty** (D36).
 *
 * D31 reserved `/api/plugins/` for this, and D34 took it back: management needs
 * that space more. Once `POST /api/plugins/acme/grant` is a management verb, a
 * plugin route named `grant` is unroutable and nothing at match time tells the
 * two apart — so the reservation had to move, and it had to move in the change
 * that defined the management API rather than after it. That is D31's own
 * argument for reserving anything: it costs nothing now and is unavailable
 * later.
 *
 * When routes arrive (phase 6) a plugin will mount **under its own name** here
 * and will not be able to escape it, gated by an `http:route` claim.
 * `RouteManager` already documents that registration order is load-bearing for
 * Hono's matcher; letting third parties into that ordering is how a plugin
 * breaks entry reads by accident.
 */
export class ExtRoutes {
  static register(app: any) {
    app.all("/api/ext/*", (c: any) =>
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
