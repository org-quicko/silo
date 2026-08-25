/**
 * One argument a generated client method takes, and where it goes in the
 * request it builds (D35).
 *
 * `kind` is the whole of the mapping. There are five, and the fact that five is
 * enough for the surface a plugin reaches is why the client can be generated at
 * all: an operation that needed a sixth would be one the contract could not
 * describe, and `ctx.fetch` is the honest answer for those rather than a
 * special case bolted on here.
 */
export interface PluginApiParameter {
  name: string;

  /**
   * - `scope` — a `{ project, env }` pair filling the `{project}` and `{env}`
   *   placeholders. Its own kind because every scoped route takes both, and two
   *   path parameters would make every call site spell the pair out.
   * - `path` — one placeholder, URL-encoded.
   * - `query` — an object flattened onto the query string.
   * - `body` — JSON-serialized as the request body.
   * - `rev` — sent as `If-Match`, which is how every fenced route on the HTTP
   *   API takes an expected revision.
   */
  kind: "scope" | "path" | "query" | "body" | "rev";

  /** The TypeScript type as it appears in the emitted declaration. */
  type: string;

  optional?: boolean;
}
