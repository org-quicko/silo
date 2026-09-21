package in.org.quicko.silo.client;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Every route this client reaches, and every route it deliberately does not.
 *
 * <p>The point is that the two lists together account for the whole API: a route
 * in neither is a gap. There is no generic {@code request()} escape hatch in
 * this client, so a route it does not cover is a client change rather than a
 * hand-built request, which is what makes the inventory worth keeping.
 *
 * <p>Paths use the server's own {@code :param} spelling and the {@code /envs/}
 * spelling of the two it accepts, so this list can be compared against the
 * TypeScript client's own inventory.
 */
public final class RouteInventory {
  private RouteInventory() {}

  /** Reached by a typed method on this client. */
  public static final List<String> Covered = List.of(
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
      "POST /api/media/:id/content",
      "POST /api/media/delete",
      "GET /api/media/folders",
      "POST /api/media/folders",
      "PATCH /api/media/folders",
      "DELETE /api/media/folders");

  /**
   * Out of scope on purpose, each with the reason. Operator surfaces belong to
   * the admin UI and the CLI, and none of it is content.
   */
  public static final Map<String, String> OutOfScope = outOfScope();

  /** Whether the inventory accounts for a route at all. */
  public static boolean accountsFor(String route) {
    return Covered.contains(route) || OutOfScope.containsKey(route);
  }

  private static Map<String, String> outOfScope() {
    Map<String, String> reasons = new LinkedHashMap<>();
    reasons.put("GET /api/session", "key introspection, an operator surface");
    reasons.put("GET /api/keys", "keys and claims are an operator surface");
    reasons.put("POST /api/keys", "keys and claims are an operator surface");
    reasons.put("PATCH /api/keys/:id", "keys and claims are an operator surface");
    reasons.put("DELETE /api/keys/:id", "keys and claims are an operator surface");
    reasons.put("GET /api/audit", "an operator surface");
    reasons.put("GET /api/observability", "an operator surface");
    reasons.put("GET /api/settings", "an operator surface");
    reasons.put("PUT /api/settings/:table", "an operator surface");
    reasons.put("GET /api/export", "transfer is an operator surface");
    reasons.put("POST /api/import", "transfer is an operator surface");
    reasons.put("POST /api/copy", "transfer is an operator surface");
    reasons.put("POST /api/projects/:project/envs/:env/copy", "scope-to-scope copy is transfer");
    reasons.put("POST /api/search/reindex", "rebuilding the index is an operator action");
    reasons.put("POST /api/media/purge", "emptying the library is an operator action");
    reasons.put("POST /api/media/reconcile", "an operator action");
    reasons.put("GET /api/media/storage", "media configuration is an operator surface");
    reasons.put("PUT /api/media/storage", "media configuration is an operator surface");
    reasons.put("GET /api/media/settings", "media configuration is an operator surface");
    reasons.put("PUT /api/media/settings", "media configuration is an operator surface");
    reasons.put("GET /api/plugins", "plugins are an operator surface");
    reasons.put("GET /api/plugins/:name", "plugins are an operator surface");
    reasons.put("GET /api/plugins/:name/ui", "a plugin's admin panel, rendered by the admin UI");
    reasons.put("DELETE /api/plugins/:name", "plugins are an operator surface");
    reasons.put("POST /api/plugins/install", "plugins are an operator surface");
    reasons.put("ALL /api/ext/*", "routes a plugin contributes; their shapes are the plugin's, not silo's");
    reasons.put("PUT /api/plugins/:name/grant", "plugins are an operator surface");
    reasons.put("DELETE /api/plugins/:name/grant", "plugins are an operator surface");
    reasons.put("POST /api/plugins/:name/enable", "plugins are an operator surface");
    reasons.put("POST /api/plugins/:name/disable", "plugins are an operator surface");
    reasons.put("POST /api/plugins/:name/restart", "plugins are an operator surface");
    reasons.put("PATCH /api/plugins/:name/config", "plugins are an operator surface");
    reasons.put("DELETE /api/plugins/:name/config", "plugins are an operator surface");
    reasons.put("POST /api/plugins/rescan", "plugins are an operator surface");
    reasons.put("GET /media/:idOrKey", "a browser URL, not a call: use asset.url()");
    return Map.copyOf(reasons);
  }
}
