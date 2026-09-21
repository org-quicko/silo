/** A JSON-RPC 2.0 id. `null` is legal on a request and required on a parse-error reply. */
export type JsonRpcId = string | number | null;

/** A request, or a notification when `id` is absent. */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** One of `result` or `error`, never both. */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}
