import type { Context, Hono } from "hono";
import type { McpTool } from "./mcp-tool";
import type { McpToolResult } from "./mcp-tool-result";
import { McpToolResponse } from "./mcp-tool-response";

/**
 * Runs a tool as a request against the **same Hono app** the MCP call arrived
 * on, the way a plugin's `ctx.fetch` does (D35): `AuthMiddleware` and
 * `RouteAuth` decide, unchanged, so a tool is exactly as authorized as its
 * route. The caller's credential and host headers travel with it, so the key is
 * the one that was presented and media URLs come out as they would over HTTP.
 */
export class McpToolRunner {
  private static readonly Forwarded = [
    "authorization",
    "x-api-key",
    "host",
    "x-forwarded-proto",
    "x-forwarded-host",
  ];

  constructor(private readonly app: Hono) {}

  async call(c: Context, tool: McpTool, args: Record<string, unknown>): Promise<McpToolResult> {
    const request = tool.request(args);

    const url = new URL(request.path, new URL(c.req.url).origin);
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, value);
    }

    const headers = new Headers({ accept: "application/json" });
    for (const name of McpToolRunner.Forwarded) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }

    const init: RequestInit = { method: request.method, headers };
    if (request.body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(request.body);
    }

    const response = await this.app.request(url, init);
    return McpToolResponse.from(response);
  }
}
