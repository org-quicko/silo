/**
 * The MCP revisions this server speaks. Every one of them carries the same
 * `initialize`, `ping`, `tools/list` and `tools/call` exchange, which is all
 * silo uses, so "supported" means "will be echoed back".
 */
export class McpProtocol {
  static readonly Versions: readonly string[] = [
    "2024-11-05",
    "2025-03-26",
    "2025-06-18",
    "2025-11-25",
  ];

  /** Answered to a client asking for a revision this server does not know. */
  static readonly Latest = "2025-06-18";

  /** The client's revision when it is one of ours, else `Latest` (the spec's rule for `initialize`). */
  static negotiate(requested: unknown): string {
    return typeof requested === "string" && McpProtocol.Versions.includes(requested)
      ? requested
      : McpProtocol.Latest;
  }
}
