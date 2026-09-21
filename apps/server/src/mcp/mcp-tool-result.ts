export interface McpToolContent {
  type: "text";
  text: string;
}

/** A `tools/call` result. `isError` marks a refusal the route made, for the model to act on. */
export interface McpToolResult {
  content: McpToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
