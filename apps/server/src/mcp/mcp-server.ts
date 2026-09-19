import type { Context } from "hono";
import { JsonRpc } from "./json-rpc";
import type { JsonRpcRequest, JsonRpcResponse } from "./json-rpc-message";
import { McpArgumentValidator } from "./mcp-argument-validator";
import { McpInvalidParamsError } from "./mcp-invalid-params-error";
import { McpProtocol } from "./mcp-protocol";
import type { McpToolCatalog } from "./mcp-tool-catalog";
import type { McpToolRunner } from "./mcp-tool-runner";

export interface McpServerOptions {
  version: string;
  catalog: McpToolCatalog;
  runner: McpToolRunner;
}

/**
 * The MCP methods silo answers, one JSON-RPC message at a time. Stateless:
 * every message carries the caller's key, and the tool set never changes while
 * the process runs, so there is no session to keep between two of them.
 */
export class McpServer {
  static readonly Name = "silo";

  static readonly Instructions =
    "silo is a headless CMS. Content lives in entries; entries live in collections; a collection has a JSON Schema " +
    "and belongs to one environment of one project. Start with whoami, then list_projects, list_environments and " +
    "list_collections to find your way, and read get_schema before you create or update an entry. Updates and deletes " +
    "take the rev you last read. Every tool is checked against the key's claims; a refusal names the missing claim.";

  private readonly validator = new McpArgumentValidator();

  constructor(private readonly options: McpServerOptions) {}

  /** The reply to one message, or `null` for a notification, which gets none. */
  async handle(c: Context, message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (JsonRpc.isNotification(message)) return null;
    const id = message.id ?? null;

    try {
      switch (message.method) {
        case "initialize":
          return JsonRpc.result(id, this.initialize(message.params));
        case "ping":
          return JsonRpc.result(id, {});
        case "tools/list":
          return JsonRpc.result(id, { tools: this.options.catalog.descriptors() });
        case "tools/call":
          return JsonRpc.result(id, await this.callTool(c, message.params));
        default:
          return JsonRpc.error(id, JsonRpc.MethodNotFound, `method not found: ${message.method}`);
      }
    } catch (caught) {
      if (caught instanceof McpInvalidParamsError) {
        return JsonRpc.error(id, JsonRpc.InvalidParams, caught.message, caught.data);
      }
      const reason = caught instanceof Error ? caught.message : String(caught);
      return JsonRpc.error(id, JsonRpc.InternalError, reason);
    }
  }

  private initialize(params: unknown): Record<string, unknown> {
    const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
    return {
      protocolVersion: McpProtocol.negotiate(requested),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: McpServer.Name, version: this.options.version },
      instructions: McpServer.Instructions,
    };
  }

  private async callTool(c: Context, params: unknown) {
    const { name, arguments: args } = (params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof name !== "string") {
      throw new McpInvalidParamsError("tools/call needs a string name");
    }
    const tool = this.options.catalog.find(name);
    if (!tool) throw new McpInvalidParamsError(`unknown tool "${name}"`);

    return this.options.runner.call(c, tool, this.validator.check(tool, args));
  }
}
