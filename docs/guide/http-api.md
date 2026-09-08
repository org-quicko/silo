# HTTP API

> Every route, the query grammar, search, and the error shape. The design rationale is in [docs/design/http-api.md](../design/http-api.md).

JSON everywhere, clean routes under `/api`, no URL versioning: breaking changes
are release-note events, and the data format is versioned separately. CORS is
enabled for `/api/*`.

Present a key as `Authorization: Bearer <key>` or `X-Api-Key: <key>`.

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/health` | liveness and version, never authenticated |
| `GET` | `/api/session` | current key label, prefix, and effective claims |
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
| `GET` | `/api/export` | stream a `tar.gz` archive |
| `POST` | `/api/import?mode=` | accept a `tar.gz` archive |
| `POST` | `/api/copy` | pull and import another running silo |
| `GET` / `POST` | `/api/keys` | list keys / create one, the secret is returned exactly once |
| `DELETE` | `/api/keys/{id}` | revoke a key, and everything descended from it |
| `GET` | `/api/plugins` | list plugins: what each requested, what it was granted, and what it is doing |
| `GET` | `/api/plugins/{name}` | one plugin, with an `ETag` to send back as `If-Match` |
| `PUT` / `DELETE` | `/api/plugins/{name}/grant` | approve or narrow a grant / withdraw it |
| `POST` | `/api/plugins/{name}/enable`, `/disable` | start or stop a plugin now |
| `PATCH` / `DELETE` | `/api/plugins/{name}/config` | change its config / return it to `silo.toml` |
| `POST` | `/api/plugins/{name}/restart` | bring a dead worker back |
| `POST` | `/api/plugins/rescan` | re-read `silo.toml` and apply it |
| `GET` | `/api/audit` | who changed what authority, and when |
| `GET` | `/api/observability` | aggregate API traffic, errors, latency, process resources, and local storage (`observability:read`) |
| `GET` / `POST` | `/api/media` | list / upload media |
| `GET` | `/api/media/extensions` | the file extensions the library actually holds, for the Type filter |
| `GET` | `/api/media/{id}` | one asset's catalog record |
| `PATCH` | `/api/media/{id}` | rename, move, or retag one asset (`{filename, folder, tags}`, `media:create`) |
| `DELETE` | `/api/media/{id}` | delete a media asset, refused while an entry still references it unless `?force=true` (which also needs `entries:update` at the scopes it reaches) |
| `POST` | `/api/media/delete` | delete up to 100 assets at once (`{ids, force}`), always `200` with a `deleted`/`failed` body |
| `POST` | `/api/media/purge` | empty the whole library (`{confirm: "purge", force?}`), always `200` with a `deleted`/`failed` body plus a folder count |
| `PATCH` | `/api/media/folders` | rename or move a folder (`{from, to}`), and every asset and descendant folder within |
| `DELETE` | `/api/media/folders` | delete a folder — empty only by default, or everything inside it with `?recursive=true` (`?force=true` as above) |
| `GET` / `PUT` | `/api/media/storage` | read / change where the library keeps its bytes (`media:configure`) |
| `GET` / `PUT` | `/api/media/settings` | read / change where media URLs point and what may be uploaded (`media:configure`) |
| `GET` | `/api/settings` | the rest of `silo.toml`, with what is in force and what a restart is owed for (`settings:configure`) |
| `PUT` | `/api/settings/{table}` | rewrite one of `log`, `search`, `schema`, `auth` (`settings:configure`) |
| `GET` | `/api/projects/{project}/envs/{env}/collections/{name}/search` | search one collection |
| `GET` | `/api/projects/{project}/envs/{env}/search` | search one environment |
| `GET` | `/api/search` | search everything the key can read |
| `POST` | `/api/search/reindex` | rebuild the search index |
| `GET` | `/media/{filename}` | public asset streaming, immutable cache headers |

`/environments` is accepted anywhere `/envs` appears. Collection, entry, and
environment-copy routes are scoped to a `(project, environment)` pair;
everything else is instance-wide.

**Variables are resolved on the way out.** Every `{{NAME}}` an entry holds is
replaced with this environment's value before the entry is returned, after media
resolution. A name that nothing declares, and a name with no value here, is left
standing rather than blanked. Pass `?variables=raw` on an entry or search read
to get the templates back unresolved, which is what an editor needs so a form
does not save a resolved value over the reference somebody typed.

Reading and writing `posts` in `default/prod`:

```sh
curl http://localhost:8090/api/projects/default/envs/prod/collections/posts

curl -X POST http://localhost:8090/api/projects/default/envs/prod/collections/posts \
  -H "Authorization: Bearer $SILO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello"}'
```

**Entry representation.** An entry is returned flattened: its `id`, then its own
fields, then `created_at` and `updated_at`. The rest of the envelope stays
internal.

**List queries.** `?filter=<url-encoded JSON>&sort=-$.updated_at,$.data.title&limit=50&offset=0`.

Fields are addressed with [RFC 9535](https://www.rfc-editor.org/rfc/rfc9535)
JSONPath, over an entry document of `{id, rev, created_at, updated_at, data}` —
your own fields live under `$.data`, so a field named `id` can never shadow the
envelope's. The supported subset is the root, name selectors, array indices
(negative included), and the child wildcard `[*]`. Recursive descent, slices,
unions, filter selectors and function extensions are refused by name rather than
silently ignored.

The filter is a small AST rather than a string language:

```json
{"op": "and", "args": [
  {"op": "eq", "path": "$.data.status", "value": "published"},
  {"op": "contains", "path": "$.data.author.name", "value": "ada"},
  {"op": "eq", "path": "$.data.tags[*]", "value": "release"}
]}
```

Leaf operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, and
`exists`; `and`, `or` and `not` take `args`. A leaf is true when **any** node
the path selects satisfies it, and any-over-nothing is false — so
`neq($.data.tags[*], "x")` means *some tag is not "x"*, while
`not(eq($.data.tags[*], "x"))` means *no tag is*. Sort paths must select at
most one node. The default limit is 50 and the maximum is 500. The response is
`{"data": [...], "total": n, "limit": ..., "offset": ...}`.

**Search.** The same `filter`, `sort`, `limit` and `offset`, plus `q` for text,
at three reaches — one collection, one environment, or everything the key can
read. The reach is in the path and never in a parameter, so a forgotten value
cannot widen a search:

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

A snippet is three strings — the fragment is `before + match + after`, and
`match` is the run to highlight — so text containing brackets of its own needs
no escaping. `engine` is `fts5` when SQLite's full-text index answered and
`scan` when the portable engine walked the entries instead; `truncated` is true
only for the latter, and means `total` counts what was examined. A `sort` beats
relevance, so omit it to rank. Which fields are indexed is a schema decision
(`x-silo-search`), and an anonymous caller reaches only collections whose schema
does not set `x-silo-auth`.

**Optimistic concurrency.** `PUT` and `DELETE` on an entry require the revision
you expect, as `If-Match: "3"` or `?rev=3`. Every entry response carries its
current `rev`, so send back the one you read. A mismatch returns `409`, which is
what stops two admin tabs from silently overwriting each other.

**Errors.** `{"error": {"code": "...", "message": "...", "details": [...]}}` with
codes `validation_failed` (400), `unauthorized` (401), `forbidden` (403),
`not_found` (404), `conflict` (409), and `internal` (500). Validation details
carry JSON Pointer paths from the validator. Two failures get codes of their
own because they are neither a refusal nor a bug and a caller can act on them:
`media_delete_stalled` (500) and `plugin_start_failed` (500), each carrying a
`remedy` in `details`.

