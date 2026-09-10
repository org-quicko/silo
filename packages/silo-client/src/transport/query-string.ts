import type { TransportQueryValue } from "./transport-request.js";

/**
 * Builds the `?a=1&b=2` suffix for a request. Omits `undefined` and `null`
 * values, JSON-encodes an object value (the `filter` AST) before
 * URL-encoding it, and returns `""` when nothing is set — so a call site can
 * concatenate the result onto a path unconditionally.
 */
export class QueryString {
  static build(query: Record<string, TransportQueryValue> | undefined): string {
    if (!query) return "";

    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      const encoded = typeof value === "object" ? JSON.stringify(value) : String(value);
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(encoded)}`);
    }

    return parts.length > 0 ? `?${parts.join("&")}` : "";
  }
}
