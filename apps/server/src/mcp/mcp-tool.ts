/** The HTTP request a tool call becomes. `path` is under `/api/`; `body` is sent as JSON. */
export interface McpToolRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

/** The MCP tool annotations, as the spec names them. */
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * One tool: what a client is told about it, and the route it stands for.
 * Authorization is the route's, not the tool's — see docs/design/http-api.md §8.6.
 */
export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
  /** Maps arguments already checked against `inputSchema` to the request. */
  request(args: Record<string, unknown>): McpToolRequest;
}
