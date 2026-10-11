import type { McpToolResult } from "./mcp-tool-result";

/** Turns the route's HTTP answer into a `tools/call` result. */
export class McpToolResponse {
  static async from(response: Response): Promise<McpToolResult> {
    const text = await response.text();
    const body = McpToolResponse.parse(text);

    if (response.status >= 400) {
      return {
        content: [{ type: "text", text: McpToolResponse.describeError(response.status, body, text) }],
        isError: true,
      };
    }

    if (response.status === 204 || text.trim() === "") {
      return { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true } };
    }

    const result: McpToolResult = {
      content: [{ type: "text", text: body === undefined ? text : JSON.stringify(body, null, 2) }],
    };
    // An array is legal JSON but not a legal structuredContent; the text has it either way.
    if (body && typeof body === "object" && !Array.isArray(body)) {
      result.structuredContent = body as Record<string, unknown>;
    }
    return result;
  }

  private static parse(text: string): unknown {
    if (text.trim() === "") return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /** `code (status): message`, with the validator's details when there are any. */
  private static describeError(status: number, body: unknown, text: string): string {
    const error =
      body && typeof body === "object" && "error" in body
        ? ((body as { error?: Record<string, unknown> }).error ?? {})
        : undefined;
    if (!error) return `HTTP ${status}: ${text || "no body"}`;

    const code = typeof error.code === "string" ? error.code : "error";
    const message = typeof error.message === "string" ? error.message : "";
    const head = `${code} (${status}): ${message}`.trim();
    return error.details === undefined
      ? head
      : `${head}\n${JSON.stringify(error.details, null, 2)}`;
  }
}
