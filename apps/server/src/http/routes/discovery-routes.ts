import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { McpCatalogView, type McpToolCatalog } from "../../mcp";
import { LlmsTxt } from "../llms-txt";
import { OpenApiDocument } from "../openapi-document";
import { RequestUtils } from "./request-utils";

/**
 * Unauthenticated discovery routes at the server root: `/openapi.json`,
 * `/mcp`, and `/llms.txt`.
 *
 * Registered before the SPA fallback so AI agents, schema viewers, and code
 * generators always receive machine-readable metadata rather than `index.html`,
 * even when an instance enforces API keys everywhere else.
 */
export class DiscoveryRoutes {
  static readonly OpenApiPath = "/openapi.json";
  static readonly McpPath = "/mcp";
  static readonly LlmsTxtPath = "/llms.txt";

  private static readonly DisallowedMethods = ["POST", "PUT", "PATCH", "DELETE"] as const;

  static register(app: Hono, options: { version: string; catalog: McpToolCatalog }): void {
    const allowCrossOriginRead = cors({ allowMethods: ["GET", "HEAD"] });
    const mcpCatalogPayload = McpCatalogView.build({
      version: options.version,
      catalog: options.catalog,
    });

    app.use(DiscoveryRoutes.OpenApiPath, allowCrossOriginRead);
    app.use(DiscoveryRoutes.McpPath, allowCrossOriginRead);
    app.use(DiscoveryRoutes.LlmsTxtPath, allowCrossOriginRead);

    app.get(DiscoveryRoutes.OpenApiPath, (c: Context) => {
      return new Response(OpenApiDocument.json(), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });

    app.get(DiscoveryRoutes.McpPath, (c: Context) => {
      c.header("Cache-Control", "no-cache");
      c.header("X-Content-Type-Options", "nosniff");
      return c.json(mcpCatalogPayload);
    });

    app.get(DiscoveryRoutes.LlmsTxtPath, (c: Context) => {
      const body = LlmsTxt.render({
        baseUrl: RequestUtils.getBaseUrl(c),
        version: options.version,
        catalog: options.catalog,
      });
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });

    for (const routePath of [
      DiscoveryRoutes.OpenApiPath,
      DiscoveryRoutes.McpPath,
      DiscoveryRoutes.LlmsTxtPath,
    ]) {
      app.on([...DiscoveryRoutes.DisallowedMethods], routePath, DiscoveryRoutes.methodNotAllowed);
    }
  }

  private static methodNotAllowed(c: Context): Response {
    const message =
      c.req.path === DiscoveryRoutes.McpPath
        ? "GET /mcp is read-only and only accepts GET and HEAD; send MCP JSON-RPC requests to POST /api/mcp."
        : `${c.req.path} is read-only and only accepts GET and HEAD.`;
    return c.json({ error: { code: "method_not_allowed", message } }, 405, { Allow: "GET, HEAD" });
  }
}
