import { McpProtocol } from "./mcp-protocol";
import { McpRoutes } from "./mcp-routes";
import { McpServer } from "./mcp-server";
import type { McpToolCatalog } from "./mcp-tool-catalog";

export interface McpCatalogViewPayload {
  server: { name: string; version: string };
  endpoint: string;
  transport: {
    type: string;
    method: string;
    stateless: boolean;
    protocol_versions: readonly string[];
    latest_protocol_version: string;
    stdio_bridge: string;
  };
  auth: {
    required: boolean;
    type: string;
    headers: readonly string[];
    notes: string;
  };
  instructions: string;
  tools: Record<string, unknown>[];
}

/** Builds the unauthenticated `GET /mcp` payload from the live MCP server metadata and catalog. */
export class McpCatalogView {
  static build(options: { version: string; catalog: McpToolCatalog }): McpCatalogViewPayload {
    return {
      server: {
        name: McpServer.Name,
        version: options.version,
      },
      endpoint: McpRoutes.Path,
      transport: {
        type: "streamable-http",
        method: "POST",
        stateless: true,
        protocol_versions: [...McpProtocol.Versions],
        latest_protocol_version: McpProtocol.Latest,
        stdio_bridge: "silo mcp",
      },
      auth: {
        required: true,
        type: "api_key",
        headers: ["Authorization: Bearer <key>", "X-Api-Key: <key>"],
        notes:
          "POST /api/mcp requires an API key even for public collections or media reads. Every tool call enforces the key's claims against the underlying HTTP route.",
      },
      instructions: McpServer.Instructions,
      tools: options.catalog.descriptors(),
    };
  }
}
