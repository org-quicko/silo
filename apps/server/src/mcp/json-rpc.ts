import type { JsonRpcId, JsonRpcRequest, JsonRpcResponse } from "./json-rpc-message";

/** The JSON-RPC 2.0 vocabulary MCP rides on: the error codes, and the two reply shapes. */
export class JsonRpc {
  static readonly ParseError = -32700;
  static readonly InvalidRequest = -32600;
  static readonly MethodNotFound = -32601;
  static readonly InvalidParams = -32602;
  static readonly InternalError = -32603;
  /** silo's own: an HTTP answer the stdio bridge could not turn into a reply. */
  static readonly UpstreamError = -32000;

  /** A request or a notification: `jsonrpc: "2.0"` and a string `method`. */
  static isRequest(value: unknown): value is JsonRpcRequest {
    if (!value || typeof value !== "object") return false;
    const message = value as Record<string, unknown>;
    return message.jsonrpc === "2.0" && typeof message.method === "string";
  }

  /** A notification has no `id` member at all; `id: null` is still a request. */
  static isNotification(message: JsonRpcRequest): boolean {
    return !("id" in message);
  }

  /** The id off anything that might carry one, for an error reply about a shape we could not read. */
  static idOf(value: unknown): JsonRpcId {
    if (!value || typeof value !== "object") return null;
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" || typeof id === "number" ? id : null;
  }

  static result(id: JsonRpcId, result: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", id, result };
  }

  static error(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
  }
}
