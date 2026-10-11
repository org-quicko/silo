import type { Context, Hono } from "hono";
import { JsonRpc } from "./json-rpc";
import type { JsonRpcResponse } from "./json-rpc-message";
import { McpServer } from "./mcp-server";
import { McpToolCatalog } from "./mcp-tool-catalog";
import { McpToolRunner } from "./mcp-tool-runner";

/**
 * MCP over Streamable HTTP at `POST /api/mcp`, under the same middleware every
 * API route has: CORS, the JSON body ceiling, and `AuthMiddleware`. Stateless
 * on purpose (§8.6): no `Mcp-Session-Id`, no event stream, no session to end,
 * so `GET` and `DELETE` answer 405.
 */
export class McpRoutes {
  static readonly Path = "/api/mcp";

  static register(app: Hono, options: { version: string }): void {
    const server = new McpServer({
      version: options.version,
      catalog: McpToolCatalog.default(),
      runner: new McpToolRunner(app),
    });

    app.post(McpRoutes.Path, async (c: Context) => {
      // A key is required even where a plain read would be public: a client
      // arriving without one has nothing configured, and should hear that
      // rather than see a tool list it can call nothing on.
      if (!c.get("keyInfo")) {
        return c.json(
          {
            error: {
              code: "unauthorized",
              message: "MCP needs an API key: send Authorization: Bearer <key>",
            },
          },
          401,
          { "WWW-Authenticate": 'Bearer realm="silo"' }
        );
      }

      let parsed: unknown;
      try {
        parsed = await c.req.json();
      } catch {
        return c.json(JsonRpc.error(null, JsonRpc.ParseError, "body is not JSON"), 400);
      }

      const messages = Array.isArray(parsed) ? parsed : [parsed];
      const replies: JsonRpcResponse[] = [];
      for (const message of messages) {
        if (!JsonRpc.isRequest(message)) {
          replies.push(
            JsonRpc.error(JsonRpc.idOf(message), JsonRpc.InvalidRequest, "not a JSON-RPC 2.0 request")
          );
          continue;
        }
        const reply = await server.handle(c, message);
        if (reply) replies.push(reply);
      }

      // Notifications alone: accepted, nothing to say (the spec's 202).
      if (replies.length === 0) return c.body(null, 202);
      return c.json(Array.isArray(parsed) ? replies : replies[0]);
    });

    app.get(McpRoutes.Path, McpRoutes.methodNotAllowed);
    app.delete(McpRoutes.Path, McpRoutes.methodNotAllowed);
  }

  private static methodNotAllowed(c: Context): Response {
    return c.json(
      {
        error: {
          code: "method_not_allowed",
          message:
            "silo's MCP endpoint is stateless: POST every message to /api/mcp. There is no event stream to open and no session to end.",
        },
      },
      405,
      { Allow: "POST" }
    );
  }
}
