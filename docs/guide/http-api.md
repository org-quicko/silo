# HTTP API

> Every route, the query grammar, search, and the error shape. The design rationale is in [docs/design/http-api.md](../design/http-api.md).

JSON everywhere, and clean routes under `/api`. There is no URL versioning: a
breaking change is a release-note event, and the data format carries its own
version. CORS is enabled for `/api/*`.

[docs/openapi.json](../openapi.json) is the same API as an OpenAPI 3.1
description. Open it in Swagger UI or Redoc, or give it to a code generator to
make a client. This page is the short version that you read.

Present a key as `Authorization: Bearer <key>` or `X-Api-Key: <key>`.

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/health` | liveness and version, never authenticated |
| `GET` | `/api/session` | current key label, prefix, and effective claims |
| `POST` | `/api/mcp` | MCP over Streamable HTTP: one JSON-RPC message, or a batch, in; the reply out. Needs a key. `GET` and `DELETE` answer `405`. See [mcp.md](mcp.md) |
| `GET` / `POST` | `/api/projects` | list projects visible to the key / create `{id}` |
| `PATCH` | `/api/projects/{project}` | rename a project, and rewrite the claims that name it (`?dry_run=true`) |
| `DELETE` | `/api/projects/{project}` | delete a project, its environments and their collections (`?force=true`) |
| `GET` / `POST` | `/api/projects/{project}/envs` | list environments / create `{id}` |
| `PATCH` | `/api/projects/{project}/envs/{env}` | rename an environment (`?dry_run=true`) |
| `DELETE` | `/api/projects/{project}/envs/{env}` | delete an environment and its collections (`?force=true`) |
| `POST` | `/api/projects/{project}/envs/{env}/copy` | copy another environment of this instance into it |
| `POST` | `/api/projects/{project}/variables` | declare a variable, and value it in one environment with `?env=` |
| `PATCH` / `DELETE` | `/api/projects/{project}/variables/{name}` | rename or re-describe a declaration / undeclare it everywhere |
| `GET` | `/api/projects/{project}/envs/{env}/variables` | the declarations, with this environment's values |
| `PUT` / `DELETE` | `/api/projects/{project}/envs/{env}/variables/{name}` | set / unset one value here |
| `GET` / `POST` | `/api/projects/{project}/envs/{env}/collections` | list / create `{name, schema}` |
| `PATCH` | `/api/projects/{project}/envs/{env}/collections/{name}` | rename a collection (`?dry_run=true`) |
| `GET` / `PUT` / `DELETE` | `/api/projects/{project}/envs/{env}/collections/{name}/schema` | fetch / update / delete a schema |
| `GET` / `POST` | `/api/projects/{project}/envs/{env}/collections/{name}` | list entries (filter, sort, paginate) / create |
| `GET` / `PUT` / `DELETE` | `/api/projects/{project}/envs/{env}/collections/{name}/{id}` | read / full replace / delete |
| `GET` | `/api/export?include=&media=` | stream a `tar.gz` archive, whole or narrowed |
| `POST` | `/api/import?mode=&include=&media=` | accept a `tar.gz` archive |
| `POST` | `/api/copy` | pull and import another running silo |
| `GET` / `POST` | `/api/keys` | list keys / create one. The secret is returned exactly once |
| `DELETE` | `/api/keys/{id}` | revoke a key, and everything descended from it |
| `GET` | `/api/plugins` | list plugins: what each requested, what it was granted, and what it is doing |
| `GET` | `/api/plugins/{name}` | one plugin, with an `ETag` to send back as `If-Match` |
| `PUT` / `DELETE` | `/api/plugins/{name}/grant` | approve or narrow a grant / withdraw it |
| `POST` | `/api/plugins/{name}/enable`, `/disable` | start or stop a plugin now |
| `PATCH` / `DELETE` | `/api/plugins/{name}/config` | change its config / return it to `silo.toml` |
| `POST` | `/api/plugins/{name}/restart` | bring a dead worker back |
| `POST` | `/api/plugins/rescan` | re-read `silo.toml` and apply it |
| `GET` | `/api/trash` | what has been deleted and can still be restored (`?kind=&project=&env=&collection=&q=`) |
| `GET` | `/api/trash/{id}` | one trash item |
| `GET` | `/api/trash/{id}/items` | the records that item parked, read only |
| `POST` | `/api/trash/{id}/restore` | put it back (`{rename?, chain?}`). Asks for the write claims at the destination |
| `DELETE` | `/api/trash/{id}` | destroy one trash item for good (`trash:purge`) |
| `POST` | `/api/trash/purge` | empty the trash (`{confirm: "empty"}`, `trash:purge`) |
| `GET` | `/api/audit` | who changed what authority, and when |
| `GET` | `/api/observability` | aggregate API traffic, errors, latency, process resources, and local storage (`observability:read`) |
| `GET` / `POST` | `/api/media` | list / upload media |
| `GET` | `/api/media/extensions` | the file extensions the library actually holds, for the Type filter |
| `GET` | `/api/media/{id}` | one asset's catalog record |
| `GET` | `/api/media/{id}/usages` | the entries that reference this asset. Answers `total`, `visible` and `visible_capped`, because a key may not read every referrer |
| `PATCH` | `/api/media/{id}` | rename, move, or retag one asset (`{filename, folder, tags}`, `media:create`) |
| `POST` | `/api/media/{id}/content` | replace the file behind one asset (multipart `file`). Keeps the id, the name and the URL, so every entry that refers to it shows the new file. The new file must keep the same file type. Needs `media:replace`, and `entries:update` at the scopes it reaches |
| `DELETE` | `/api/media/{id}` | delete a media asset. Refused while an entry still references it, unless `?force=true`, which also needs `entries:update` at the scopes it reaches |
| `POST` | `/api/media/delete` | delete up to 100 assets at once (`{ids, force}`). Always `200`, with a `deleted`/`failed` body |
| `POST` | `/api/media/purge` | empty the whole library (`{confirm: "purge", force?}`). Always `200`, with a `deleted`/`failed` body plus a folder count. Needs `media:delete` and `media:purge` |
| `GET` | `/api/media/folders` | the folders the library holds |
| `POST` | `/api/media/folders` | create a folder (`{path}`, `media:create`) |
| `PATCH` | `/api/media/folders` | rename or move a folder (`{from, to}`), and every asset and descendant folder within |
| `DELETE` | `/api/media/folders` | delete a folder. Empty only by default, or everything inside it with `?recursive=true` (`?force=true` as above) |
| `GET` / `PUT` | `/api/media/storage` | read / change where the library keeps its bytes (`media:configure`) |
| `GET` / `PUT` | `/api/media/settings` | read / change where media URLs point, and what may be uploaded (`media:configure`) |
| `GET` | `/api/settings` | the rest of `silo.toml`, with what is in force and what a restart is owed for (`settings:configure`) |
| `PUT` | `/api/settings/{table}` | rewrite one of `log`, `search`, `schema`, `auth` (`settings:configure`) |
| `GET` | `/api/projects/{project}/envs/{env}/collections/{name}/search` | search one collection |
| `GET` | `/api/projects/{project}/envs/{env}/search` | search one environment |
| `GET` | `/api/search` | search everything the key can read |
| `POST` | `/api/search/reindex` | rebuild the search index |
| `GET` | `/media/{id}` | public asset streaming. The file is read from the store as it is sent, never held whole. A single `Range: bytes=...` header answers `206` with `Content-Range`; a range past the end answers `416`. A whole answer has no `Content-Length`. Every answer carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. Images, video, audio and PDF are sent `inline`; an SVG and any other type is sent as an `attachment`, so a browser downloads it instead of showing it as a page. An `<img>` tag still displays it |

`/environments` is accepted anywhere `/envs` appears. Collection, entry and
environment-copy routes are scoped to a `(project, environment)` pair.
Everything else is instance-wide.

Reading and writing `posts` in `default/prod`:

```sh
curl http://localhost:8090/api/projects/default/envs/prod/collections/posts

curl -X POST http://localhost:8090/api/projects/default/envs/prod/collections/posts \
  -H "Authorization: Bearer $SILO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello"}'
```

## Entry representation

An entry is returned flattened: its `id`, then its own fields, then
`created_at` and `updated_at`. The rest of the envelope stays internal.

## Variables

Every `{{NAME}}` an entry holds is replaced with this environment's value before
the entry is returned. That happens after media resolution. A name that nothing
declares, and a name with no value in this environment, is left standing rather
than blanked.

Pass `?variables=raw` on an entry or a search read to get the templates back
unresolved. An editor needs that, so a form cannot save a resolved value over
the reference somebody typed.

## List queries

```
?filter=<url-encoded JSON>&sort=-$.updated_at,$.data.title&limit=50&offset=0
```

Fields are addressed with [RFC 9535](https://www.rfc-editor.org/rfc/rfc9535)
JSONPath, over an entry document of `{id, rev, created_at, updated_at, data}`.
Your own fields live under `$.data`, so a field named `id` can never shadow the
envelope's.

The supported subset is the root, name selectors, array indices (negative
included), and the child wildcard `[*]`. silo refuses recursive descent, slices,
unions, filter selectors and function extensions by name, rather than ignoring
them in silence.

The filter is a small AST, not a string language:

```json
{"op": "and", "args": [
  {"op": "eq", "path": "$.data.status", "value": "published"},
  {"op": "contains", "path": "$.data.author.name", "value": "ada"},
  {"op": "eq", "path": "$.data.tags[*]", "value": "release"}
]}
```

Leaf operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains` and
`exists`. `and`, `or` and `not` take `args`.

A leaf is true when **any** node the path selects satisfies it, and any over
nothing is false. So `neq($.data.tags[*], "x")` means *some tag is not "x"*,
while `not(eq($.data.tags[*], "x"))` means *no tag is*.

A sort path must select at most one node. The default limit is 50 and the
maximum is 500. The response is
`{"data": [...], "total": n, "limit": ..., "offset": ...}`.

## Search

Search takes the same `filter`, `sort`, `limit` and `offset`, plus `q` for the
text. It has three reaches: one collection, one environment, or everything the
key can read. The reach is in the path and never in a parameter, so a forgotten
value cannot widen a search.

```sh
curl "http://localhost:8090/api/search?q=pricing" -H "Authorization: Bearer $SILO_KEY"
```

A result names where it was found, and quotes why it matched:

```json
{"data": [{"project": "acme", "env": "prod", "collection": "posts",
           "entry": {"id": "01J8…", "title": "Pricing changes"},
           "snippets": [{"path": "$.data.body",
                         "before": "…our ", "match": "pricing", "after": " page…"}]}],
 "total": 1, "limit": 50, "offset": 0, "truncated": false, "engine": "fts5"}
```

A snippet is three strings. The fragment is `before + match + after`, and
`match` is the run to highlight, so text that contains brackets of its own needs
no escaping.

`engine` is `fts5` when SQLite's full-text index answered, and `scan` when the
portable engine walked the entries instead. `truncated` is true only for the
second, and it means `total` counts what was examined.

A `sort` beats relevance, so omit it to rank. Which fields are indexed is a
schema decision, through `x-silo-search`. An anonymous caller reaches only the
collections whose schema does not set `x-silo-auth`.

## MCP

`POST /api/mcp` is the same API for an AI client. Each tool is one of the
routes above, called with the key the client presents, so the claims decide
exactly as they do here. [mcp.md](mcp.md) lists the tools and shows how to
connect Claude Code, Codex, Cursor and Claude Desktop.

## Trash

A delete does not destroy the content. It moves it to the trash, where you can
restore it. This applies to a project, an environment, a collection, an entry, a
media asset and a media folder.

The trash keeps one item for each thing you deleted on purpose. If you delete a
collection that holds 300 entries, the trash shows one item that says
"300 entries". It does not show 301 items. When you restore that item, all 300
entries come back with it.

`GET /api/session` tells you whether this instance keeps a trash, and for how
many days.

### Read the trash

```sh
curl http://localhost:8090/api/trash \
  -H "Authorization: Bearer $SILO_KEY"
```

Narrow the list with `?kind=`, `?project=`, `?env=`, `?collection=`, `?q=`,
`?deleted_after=` and `?deleted_before=`. Page it with `?limit=` and `?offset=`.

There is no `trash:read` claim. The server shows you each item only if you can
read the content it came from. A key with `entries:read` on `default/prod/posts`
sees entries deleted from that collection, and no others. Two keys see two
different trashes.

Each item tells you where the content was, what rode along with it, who deleted
it, and when it expires:

```json
{
  "id": "01JBX...",
  "kind": "collection",
  "subject_name": "posts",
  "origin": { "project_name": "default", "env_name": "prod" },
  "contents": { "collections": 1, "entries": 300, "assets": 0, "bytes": 124400 },
  "deleted_at": "2026-09-22T09:14:03.000Z",
  "deleted_by": { "kind": "key", "label": "ci-deploy" },
  "expires_at": "2026-10-22T09:14:03.000Z",
  "restorable": true
}
```

### Restore

```sh
curl -X POST http://localhost:8090/api/trash/01JBX.../restore \
  -H "Authorization: Bearer $SILO_KEY"
```

Restoring writes the content back. It therefore asks for the write claims at the
destination, not for a claim of its own. To restore an entry into `default/prod`
you need `entries:create` there. To restore a collection you also need `create`.

The content goes back to the same place, addressed by record id. If someone
renamed the project, the environment or the collection while the content was in
the trash, the restore still finds it.

Two things can stop a restore:

- **The container is gone.** You cannot restore an entry into a collection that
  no longer exists. The item says so in `blocked_by`, and `restorable` is
  `false`. If the container is in the trash too, send `{"chain": true}` to
  restore the container first and then the content.
- **The name or the id is taken.** A trashed collection frees its name at once,
  so someone can create a new `posts` while the old one is in the trash. The
  restore then answers `409` instead of writing over the new one. Send
  `{"rename": "posts-restored"}` to bring it back under a different name.

A restore reports what it could not repair. If a media asset was deleted while
an entry that references it sat in the trash, the entry comes back and
`broken_media_refs` names the reference that no longer resolves.

### Delete for good

```sh
curl -X DELETE http://localhost:8090/api/trash/01JBX... \
  -H "Authorization: Bearer $SILO_KEY"

curl -X POST http://localhost:8090/api/trash/purge \
  -H "Authorization: Bearer $SILO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"confirm": "empty"}'
```

Both need `trash:purge`. No preset carries it except `root`. Whoever deleted the
content already used their delete claim. Destroying it forever is a second
decision.

To skip the trash on the way in, add `?permanent=true` to any delete route. That
also needs `trash:purge`.

### Retention

Items expire after 30 days and the server then deletes them. Change this in
`silo.toml`:

```toml
[trash]
enabled = true
retention_days = 30
```

Set `enabled = false` to make every delete permanent, which is how silo behaved
before the trash. Set `retention_days = 0` to keep items until someone purges
them by hand.

The expiry is stamped on each item when you delete it. If you shorten
`retention_days` later, content already in the trash keeps the date it was given.

## Optimistic concurrency

`PUT` and `DELETE` on an entry require the revision you expect, as
`If-Match: "3"` or `?rev=3`. Every entry response carries its current `rev`, so
send back the one you read. A mismatch returns `409`, which is what stops two
admin tabs from overwriting each other in silence.

## Errors

```json
{"error": {"code": "...", "message": "...", "details": [...]}}
```

The codes are `validation_failed` (400), `unauthorized` (401), `forbidden`
(403), `not_found` (404), `method_not_allowed` (405, only from `/api/mcp`),
`conflict` (409), `payload_too_large` (413), `archive_too_large` (413),
`internal` (500) and `busy` (503). Validation details carry JSON Pointer paths
from the validator.

A `503 busy` comes from an entry list or a search. A filter or a sort over
entry data scans the collection. Those scans run on a separate storage thread
with a queue of 64. When the queue is full the request is refused with
`Retry-After: 1` instead of waiting. A filter may test at most 16 fields; more
is a `400`.

A `413` means the request body is larger than the route accepts. Routes that
take a JSON document accept `[http] max_json_body_size_mb` (default 4 MB). The
media upload, media replace, import and plugin install routes accept up to
`[http] max_body_size_mb` (default 128 MB). See
[configuration.md](configuration.md).

A `413` with the code `archive_too_large` comes from an import or a copy. The
archive is larger than `[transfer] max_archive_size_mb`, or it would unpack to
more than `[transfer] max_extracted_size_mb`. The message names the setting.

Every write is validated against the collection's schema. A read is not.

A `PUT` to `/collections/{name}/schema` answers `409` if the collection holds
entries and the new schema changes which entries are valid. The message gives
the collection name and the entry count. A change to `x-silo-auth`,
`x-silo-search`, `title`, `description`, `$comment` or `$schema` is always
permitted, because those do not change what is valid.

The admin UI makes the schema read-only while entries exist. It keeps the field
descriptions and the privacy toggle editable. To change `x-silo-search` on such
a collection, use this endpoint.

Two failures have codes of their own, because they are neither a refusal nor a
bug and a caller can act on them: `media_delete_stalled` (500) and
`plugin_start_failed` (500). Each carries a `remedy` in `details`.

A refused media delete has a code of its own too. `media_in_use` (409) says the
asset is still referenced, and its `details` is an object rather than a
validation list: `usage_count` is the true number of referring entries,
`visible_count` is how many of them the calling key may read,
`visible_capped` says the sample was cut short, and `referrers` enumerates up
to 20 of them.
