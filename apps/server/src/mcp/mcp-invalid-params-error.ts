/** A `tools/call` whose shape is wrong before any route is reached: answered as JSON-RPC `-32602`. */
export class McpInvalidParamsError extends Error {
  constructor(
    message: string,
    readonly data?: unknown
  ) {
    super(message);
    this.name = "McpInvalidParamsError";
  }
}
