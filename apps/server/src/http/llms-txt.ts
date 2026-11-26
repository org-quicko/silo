import type { McpTool, McpToolCatalog } from "../mcp";
import { McpRoutes } from "../mcp";

export interface LlmsTxtOptions {
  baseUrl: string;
  version: string;
  catalog: McpToolCatalog;
}

/**
 * Generates `/llms.txt` describing how AI agents and developers can discover
 * and use this silo instance's OpenAPI specification, MCP endpoint, open MCP
 * tool catalog, and REST API.
 */
export class LlmsTxt {
  static render(options: LlmsTxtOptions): string {
    const origin = LlmsTxt.normalizeOrigin(options.baseUrl);
    const exampleOrigin = origin || "http://localhost:8090";
    const tools = options.catalog.all();

    return [
      "# silo",
      "",
      "> Minimal, self-hosted headless CMS storing JSON documents in SQLite, filesystem, or Postgres, with JSON Schema draft 2020-12 collections, REST APIs under `/api`, an OpenAPI 3.1 specification, and a stateless MCP server.",
      "",
      `Instance version: \`${options.version}\``,
      "",
      "## Discovery",
      "",
      `- [OpenAPI 3.1 specification](${origin}/openapi.json): Complete HTTP API contract (routes, parameters, request/response schemas, error formats, and required claims). Unauthenticated.`,
      `- [MCP tool catalog](${origin}/mcp): Unauthenticated JSON listing of all ${tools.length} MCP tools with input schemas, annotations, transport details, and usage instructions.`,
      `- [MCP endpoint](${origin}${McpRoutes.Path}): Stateless MCP over Streamable HTTP (\`POST\` JSON-RPC 2.0). Requires an API key.`,
      `- [Health check](${origin}/api/health): Unauthenticated liveness and version endpoint.`,
      "",
      "## Authentication & Claims",
      "",
      "silo has no user accounts, cookies, or browser sessions. Authenticate with an API key (`silo_...`) in either header:",
      "",
      "- `Authorization: Bearer <key>`",
      "- `X-Api-Key: <key>`",
      "",
      "Call `GET /api/session` (or the `whoami` MCP tool) to inspect the active key's label, prefix, effective claims, and trash configuration.",
      "",
      "Claims are deny-by-default:",
      "",
      "- Root: `*`",
      "- Collections: `collections:<project>/<env>/<collection>:<perm>` where each scope segment supports `*` or a `prefix*` (min 3 literal chars before `*`), and `<perm>` is one of `create`, `delete`, `schema:read`, `schema:update`, `access:update`, `entries:create`, `entries:read`, `entries:update`, `entries:delete`",
      "- Media: `media:create`, `media:delete`, `media:replace`, `media:purge`, `media:configure` (media catalog and asset reads require no claim)",
      "- Keys & Transfer: `keys:read`, `keys:create`, `keys:revoke`, `keys:export`, `keys:import`, `transfer:export`, `transfer:import`, `transfer:copy`",
      "- Operations & Plugins: `plugins:read`, `plugins:configure`, `plugins:grant`, `plugins:enable`, `audit:read`, `observability:read`, `settings:configure`, `trash:purge`, `http:route`",
      "",
      "Anonymous HTTP reads work for collections whose schema does not set `\"x-silo-auth\": true`, media catalog reads (`/api/media*`), `/media/{id}`, `/api/health`, `/openapi.json`, `/mcp`, and `/llms.txt`. Once an API key is presented on `/api/*`, its claims become the visibility boundary even for public collections.",
      "",
      "## MCP (Model Context Protocol)",
      "",
      `- Inspect all tools openly without credentials at \`GET ${origin}/mcp\` (\`POST /mcp\` returns \`405\` pointing to \`POST /api/mcp\`).`,
      `- Execute MCP messages at \`POST ${origin}${McpRoutes.Path}\` (Streamable HTTP, stateless JSON-RPC 2.0). An API key is always required (\`401\` with \`WWW-Authenticate: Bearer\` if omitted).`,
      "- No `Mcp-Session-Id` or SSE stream is used; `GET /api/mcp` and `DELETE /api/mcp` return `405 Method Not Allowed`.",
      "- Supported JSON-RPC methods: `initialize`, `ping`, `tools/list`, `tools/call`, and `notifications/*` (`202` empty response). JSON-RPC batch arrays are accepted.",
      `- Stdio bridge for process-spawning clients: \`silo mcp --url ${exampleOrigin}\` with \`SILO_API_KEY=<key>\`.`,
      "",
      "### Connecting MCP clients",
      "",
      "```bash",
      `claude mcp add --transport http silo ${exampleOrigin}${McpRoutes.Path} --header "Authorization: Bearer $SILO_API_KEY"`,
      "```",
      "",
      "```json",
      JSON.stringify(
        {
          mcpServers: {
            silo: {
              url: `${exampleOrigin}${McpRoutes.Path}`,
              headers: { Authorization: "Bearer silo_..." },
            },
          },
        },
        null,
        2
      ),
      "```",
      "",
      "### Recommended MCP workflow",
      "",
      "1. Call `whoami` to verify the key's label and claims.",
      "2. Discover scopes and schemas with `list_projects` -> `list_environments` -> `list_collections` -> `get_schema`.",
      "3. Read or search content with `list_entries`, `get_entry`, `search`, `list_variables`, `list_media`, and `get_media`.",
      "4. Before calling `create_entry` or `update_entry`, read `get_schema` and omit reserved fields (`id`, `rev`, `seq`, `created_at`, `updated_at`).",
      "5. For `update_entry` and `delete_entry`, pass the `rev` from your latest read. `update_entry` replaces the entire entry document (not a partial patch); stale revisions return `conflict (409)`.",
      "6. Invalid tool names or schema mismatches return JSON-RPC `-32602` before reaching any route; HTTP 4xx refusals (missing claims, schema errors, conflicts) return a tool result with `isError: true` and `code (status): message`.",
      "7. Media file uploads carry binary bytes and have no MCP tool; upload files directly with `POST /api/media` (`multipart/form-data` `file` field).",
      "",
      "### Available MCP tools",
      "",
      ...tools.map((tool) => LlmsTxt.formatToolLine(tool)),
      "",
      "## HTTP API",
      "",
      `Fetch \`${origin}/openapi.json\` for the complete OpenAPI 3.1 schema covering every route, parameter, request body, response shape, and required claim.`,
      "",
      "### Core conventions",
      "",
      "- **Scope hierarchy**: `/api/projects/{project}/environments/{env}/collections/{name}` (`/envs` is accepted anywhere `/environments` appears). Names match `^[a-z][a-z0-9_-]*$` (max 64 chars for projects/environments, 128 chars for collections).",
      "- **Entry representation**: Entry responses flatten `id`, the entry's own fields, `rev`, `created_at`, and `updated_at`. Reserved field names (`id`, `rev`, `seq`, `created_at`, `updated_at`) are rejected on input.",
      "- **Optimistic concurrency**: `PUT` and `DELETE` on entries require the expected revision via `If-Match: \"<rev>\"` or `?rev=<n>`. `PUT` is a full replace; mismatches return `409 conflict`.",
      "- **Environment variables**: `{{NAME}}` placeholders in entries are substituted with the environment's values by default. Pass `?variables=raw` (or `raw_variables: true` in MCP) when reading to edit so unresolved placeholders are preserved.",
      "- **List queries**: `GET .../collections/{name}?filter=<url-encoded JSON AST>&sort=-$.updated_at,$.data.title&limit=50&offset=0` (limit default `50`, max `500`). Filter leaves are `{\"op\":\"...\",\"path\":\"$.data.field\",\"value\":...}` with `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, `exists`, plus `and`, `or`, `not` taking `args`. Paths use RFC 9535 JSONPath over `{id, rev, created_at, updated_at, data}`.",
      "- **Full-text search**: `GET /api/search?q=...`, `GET /api/projects/{project}/environments/{env}/search?q=...`, and `GET .../collections/{name}/search?q=...` accept the same `filter`, `sort`, `limit`, and `offset` query parameters.",
      "- **Media**: Upload with `POST /api/media` (`multipart/form-data` `file` field, optional `folder`), reference in entries as `silo://media/<id>`, and stream publicly via `GET /media/{id}` (supports `Range` and `?download=true`).",
      "- **Trash**: Deletions move resources to `/api/trash` (unless `?permanent=true` with `trash:purge`) and return the receipt id in `X-Silo-Trash-Id` on entry, media asset, and media folder deletes.",
      "- **Errors**: All HTTP errors use `{\"error\": {\"code\": \"...\", \"message\": \"...\", \"details\": ...}}` (codes include `validation_failed`, `unauthorized`, `forbidden`, `not_found`, `method_not_allowed`, `conflict`, `payload_too_large`, `archive_too_large`, `too_many_transfers`, `busy`).",
      "",
      "## Links",
      "",
      "- [silo repository & documentation](https://github.com/org-quicko/silo)",
      "",
    ].join("\n");
  }

  private static formatToolLine(tool: McpTool): string {
    const mode = tool.annotations.readOnlyHint
      ? "read-only"
      : tool.annotations.destructiveHint
        ? "write, destructive"
        : "write";
    return `- \`${tool.name}\` (${mode}): ${tool.description}`;
  }

  /** Rejects malformed or header-injected origins, falling back to relative paths. */
  private static normalizeOrigin(baseUrl: string): string {
    if (!baseUrl) return "";
    try {
      return new URL(baseUrl).origin;
    } catch {
      return "";
    }
  }
}
