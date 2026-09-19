# MCP

> Use silo's tools from an AI client. The design rationale is in [docs/design/http-api.md](../design/http-api.md), section 8.6.

silo is an MCP server. MCP, the Model Context Protocol, is how AI clients such
as Claude Code, Claude Desktop, Codex and Cursor call tools on another program.
A running silo speaks it at `POST /api/mcp`, with the same API key you use for
the HTTP API. There is nothing else to install and nothing else to start.

Every tool call is one request on a route in [http-api.md](http-api.md), made
with the key the client was given. The key's claims decide what the client may
do, tool by tool, and a refused call tells the model which claim is missing.
Mint a key with only the claims you want to hand out; see [claims.md](claims.md).
A `read` preset key gives a model a CMS it can browse and nothing it can break.

## Connect a client

There are two transports. Use the URL when the client can send a header. Use
`silo mcp` when the client can only start a process.

### Streamable HTTP

The endpoint is `<your silo>/api/mcp`. Send the key as
`Authorization: Bearer <key>`.

Claude Code:

```bash
claude mcp add --transport http silo https://cms.example.com/api/mcp --header "Authorization: Bearer $SILO_API_KEY"
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.silo]
url = "https://cms.example.com/api/mcp"
http_headers = { Authorization = "Bearer silo_..." }
```

Cursor, and any client that reads an `mcp.json`:

```json
{
  "mcpServers": {
    "silo": {
      "url": "https://cms.example.com/api/mcp",
      "headers": { "Authorization": "Bearer silo_..." }
    }
  }
}
```

### stdio, with `silo mcp`

`silo mcp` speaks MCP on stdin and stdout and forwards every message to a
running silo. It needs the server's URL and a key, as flags or as `SILO_URL`
and `SILO_API_KEY`. Prefer the variables: a key on the command line is visible
to every process on the machine.

Claude Desktop, in `claude_desktop_config.json`, and any client with a
`command` field:

```json
{
  "mcpServers": {
    "silo": {
      "command": "silo",
      "args": ["mcp", "--url", "http://localhost:8090"],
      "env": { "SILO_API_KEY": "silo_..." }
    }
  }
}
```

Claude Code, over stdio:

```bash
claude mcp add silo --env SILO_API_KEY=silo_... -- silo mcp --url http://localhost:8090
```

The bridge opens no data directory and reads no config file. It is safe to run
beside the server it talks to, on the same machine or another. From a source
checkout, replace `silo` with `bun run apps/server/src/main.ts`.

## Connect from Silo Admin

**Settings > AI assistants** prepares setup using the API key saved for the
current Silo connection. It does not create another key or widen access: an
assistant can do exactly what this connection can do. The page offers four
client-specific actions and gives each saved server a separate connection name.

- **Claude Desktop:** download the extension, then open its `.mcpb` file. If it
  does not open, use **Settings > Extensions > Advanced settings > Install
  Extension**. The downloaded extension contains the saved API key; keep it
  private. It uses Claude Desktop's bundled Node runtime, so no separate Silo
  or Node installation is needed. See [Claude Desktop extensions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).
- **Claude Code:** copy and run the displayed user-scope command. See the
  [Claude Code MCP guide](https://code.claude.com/docs/en/mcp).
- **Codex:** copy the setup prompt into a local Codex task and let it update
  the personal configuration, approving the change if asked. A cloud task
  cannot change a local configuration. The page also offers the TOML block for
  manual setup. This personal file contains the API key and should stay
  private. See the [Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
- **Cursor:** use **Add to Cursor**, or merge the manual JSON shown by the page.
  The action opens Cursor directly and does not send the credential through a
  web proxy. See [Cursor MCP setup](https://prod.cursor.com/help/customization/mcp).

Adding or downloading configuration cannot prove that a client installed on
another machine can reach Silo. Keep Silo running; `localhost` always means the
machine that runs the assistant.

## Tools

The tool set is the same for every key. What differs is which calls succeed.
The claim column names what the route asks for; `<p>/<e>/<c>` is the
project, environment and collection the call names.

| Tool | What it does | Claim |
|------|--------------|-------|
| `whoami` | the key's label and claims | any key |
| `list_projects` | projects the key can see | any collection claim in the project |
| `create_project` | create an empty project | `collections:<p>/*/*:create` |
| `list_environments` | environments of one project | any collection claim in the environment |
| `create_environment` | create an empty environment | `collections:<p>/<e>/*:create` |
| `list_variables` | declared variables, with this environment's values | `collections:<p>/<e>/*:entries:read` |
| `list_collections` | collections in one environment, with entry counts | `collections:<p>/<e>/<c>:schema:read` per collection |
| `get_schema` | one collection's JSON Schema, references bundled | `collections:<p>/<e>/<c>:schema:read` |
| `create_collection` | create a collection from a schema | `collections:<p>/<e>/<c>:create` |
| `update_schema` | replace a schema (frozen while entries exist) | `collections:<p>/<e>/<c>:schema:update` |
| `delete_collection` | delete a collection, `force` erases its entries | `collections:<p>/<e>/<c>:delete`, plus `entries:delete` with `force` |
| `list_entries` | a filtered, sorted page of entries | `collections:<p>/<e>/<c>:entries:read` |
| `get_entry` | one entry, with its `rev` | `collections:<p>/<e>/<c>:entries:read` |
| `create_entry` | create an entry, validated against the schema | `collections:<p>/<e>/<c>:entries:create` |
| `update_entry` | replace an entry's fields, with the `rev` you read | `collections:<p>/<e>/<c>:entries:update` |
| `delete_entry` | delete an entry, with the `rev` you read | `collections:<p>/<e>/<c>:entries:delete` |
| `search` | text search of one collection, one environment, or everything | `entries:read` where it looks |
| `list_media` | the media catalog, filtered and paged | public read (the MCP endpoint still needs a key) |
| `get_media` | one asset's catalog record | public read (the MCP endpoint still needs a key) |

`list_entries` and `search` take the same `filter`, `sort`, `limit` and
`offset` the HTTP routes take. The filter is the JSON AST described in
[http-api.md](http-api.md#list-queries), passed as an object.

Media uploads have no tool. A tool call carries JSON, and a file is bytes. Use
`POST /api/media`.

## What the model sees

A result is the route's JSON answer, pretty-printed as text and repeated as
`structuredContent`. A refusal, a validation failure, a `404` or a stale `rev`
is a result with `isError: true` whose text reads `code (status): message`,
with the validator's details when there are any. The model can read it and
correct the call.

A wrong tool name, or arguments that do not match the tool's schema, is a
JSON-RPC error (`-32602`). The route was never reached.

## Protocol

silo implements `initialize`, `ping`, `tools/list` and `tools/call`, and
accepts the `notifications/*` messages a client sends. It has no resources,
no prompts, and never sends a request of its own.

The endpoint is stateless. There is no `Mcp-Session-Id`, so nothing expires
and any number of clients may share one key. `GET /api/mcp` and
`DELETE /api/mcp` answer `405`: there is no event stream to open and no
session to end. A batch (a JSON array) is accepted and answered as an array. A
message without an `id` is a notification and answers `202` with no body.

A request without a key answers `401` and a `WWW-Authenticate: Bearer`
challenge, even on an instance with public collections. silo does not do
OAuth. The key is the credential, and every client above has a place to put
it.

The route sits under `/api/*`, so CORS, the JSON body ceiling
(`[http] max_json_body_size_mb`) and the auth middleware apply as they do
everywhere else. A reverse proxy in front of silo needs no special rule for it.
