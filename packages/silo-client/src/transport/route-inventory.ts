/**
 * Every route this client reaches, and every route it deliberately does not.
 *
 * The point is that the two lists together must account for the whole API: a
 * route in neither is a gap, and `test/contract/route-inventory.test.ts`
 * checks them against the server's own registrations rather than against
 * `docs/guide/http-api.md`, which can be, and has been, incomplete.
 *
 * Paths use the server's own `:param` spelling and the `/envs/` spelling of
 * the two it accepts.
 */
export class RouteInventory {
  /** Reached by a typed method on the client. */
  static readonly Covered: readonly string[] = [
    "GET /api/health",

    "GET /api/projects",
    "POST /api/projects",
    "PATCH /api/projects/:project",
    "DELETE /api/projects/:project",
    "GET /api/projects/:project/envs",
    "POST /api/projects/:project/envs",
    "PATCH /api/projects/:project/envs/:env",
    "DELETE /api/projects/:project/envs/:env",

    "POST /api/projects/:project/variables",
    "PATCH /api/projects/:project/variables/:name",
    "DELETE /api/projects/:project/variables/:name",
    "GET /api/projects/:project/envs/:env/variables",
    "PUT /api/projects/:project/envs/:env/variables/:name",
    "DELETE /api/projects/:project/envs/:env/variables/:name",

    "GET /api/projects/:project/envs/:env/collections",
    "POST /api/projects/:project/envs/:env/collections",
    "PATCH /api/projects/:project/envs/:env/collections/:name",
    "GET /api/projects/:project/envs/:env/schemas",
    "GET /api/projects/:project/envs/:env/collections/:name/schema",
    "PUT /api/projects/:project/envs/:env/collections/:name/schema",
    "DELETE /api/projects/:project/envs/:env/collections/:name/schema",

    "GET /api/projects/:project/envs/:env/collections/:name",
    "POST /api/projects/:project/envs/:env/collections/:name",
    "GET /api/projects/:project/envs/:env/collections/:name/:id",
    "PUT /api/projects/:project/envs/:env/collections/:name/:id",
    "DELETE /api/projects/:project/envs/:env/collections/:name/:id",

    "GET /api/projects/:project/envs/:env/collections/:name/search",
    "GET /api/projects/:project/envs/:env/search",
    "GET /api/search",

    "GET /api/media",
    "POST /api/media",
    "GET /api/media/extensions",
    "GET /api/media/:id",
    "PATCH /api/media/:id",
    "DELETE /api/media/:id",
    "GET /api/media/:id/usages",
    "POST /api/media/delete",
    "GET /api/media/folders",
    "POST /api/media/folders",
    "PATCH /api/media/folders",
    "DELETE /api/media/folders",
  ];

  /**
   * Out of scope on purpose, each with the reason. Operator surfaces belong
   * to the admin UI and the CLI; none of them is content.
   */
  static readonly OutOfScope: Readonly<Record<string, string>> = {
    "GET /api/session": "key introspection, an operator surface",
    "GET /api/keys": "keys and claims are an operator surface",
    "POST /api/keys": "keys and claims are an operator surface",
    "DELETE /api/keys/:id": "keys and claims are an operator surface",
    "GET /api/audit": "an operator surface",
    "GET /api/observability": "an operator surface",
    "GET /api/settings": "an operator surface",
    "PUT /api/settings/:table": "an operator surface",
    "GET /api/export": "transfer is an operator surface",
    "POST /api/import": "transfer is an operator surface",
    "POST /api/copy": "transfer is an operator surface",
    "POST /api/projects/:project/envs/:env/copy": "scope-to-scope copy is transfer",
    "POST /api/search/reindex": "rebuilding the index is an operator action",
    "POST /api/media/purge": "emptying the library is an operator action",
    "POST /api/media/reconcile": "an operator action",
    "GET /api/media/storage": "media configuration is an operator surface",
    "PUT /api/media/storage": "media configuration is an operator surface",
    "GET /api/media/settings": "media configuration is an operator surface",
    "PUT /api/media/settings": "media configuration is an operator surface",
    "GET /api/plugins": "plugins are an operator surface",
    "GET /api/plugins/:name": "plugins are an operator surface",
    "GET /api/plugins/:name/ui": "a plugin's admin panel, rendered by the admin UI",
    "DELETE /api/plugins/:name": "plugins are an operator surface",
    "POST /api/plugins/install": "plugins are an operator surface",
    "ALL /api/ext/*": "routes a plugin contributes; their shapes are the plugin's, not silo's",
    "PUT /api/plugins/:name/grant": "plugins are an operator surface",
    "DELETE /api/plugins/:name/grant": "plugins are an operator surface",
    "POST /api/plugins/:name/enable": "plugins are an operator surface",
    "POST /api/plugins/:name/disable": "plugins are an operator surface",
    "POST /api/plugins/:name/restart": "plugins are an operator surface",
    "PATCH /api/plugins/:name/config": "plugins are an operator surface",
    "DELETE /api/plugins/:name/config": "plugins are an operator surface",
    "POST /api/plugins/rescan": "plugins are an operator surface",
    "GET /media/:idOrKey": "a browser URL, not a call: use asset.url",
  };

  /** Whether the inventory accounts for a route at all. */
  static accountsFor(route: string): boolean {
    return RouteInventory.Covered.includes(route) || route in RouteInventory.OutOfScope;
  }
}
