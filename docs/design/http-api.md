# HTTP API

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 8. HTTP API

Hono web framework on Bun. JSON everywhere. Admin UI served at `/`; API under `/api` — no URL versioning (D13): breaking API changes are release-note events tied to binary upgrades, and the data format is versioned independently via `format_version`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | liveness + version |
| GET | `/api/session` | authenticated key label, prefix, and effective claims |
| GET / POST | `/api/projects` | list scopes (filtered by claims) / create scope (`{project, env}`) |
| DELETE | `/api/projects/{project}/envs/{env}` | delete scope and its collections (`?force=true`) |
| GET / POST | `/api/projects/{project}/envs/{env}/collections` | list / create (body: `{name, schema}`) |
| GET / PUT / DELETE | `/api/projects/{project}/envs/{env}/collections/{name}/schema` | schema fetch / update / delete |
| GET / POST | `/api/projects/{project}/envs/{env}/collections/{name}` | list (query below) / create |
| GET / PUT / DELETE | `/api/projects/{project}/envs/{env}/collections/{name}/{id}` | PUT is full replace |
| GET | `/api/projects/{project}/envs/{env}/collections/{name}/search` | search one collection (§5.5) |
| GET | `/api/projects/{project}/envs/{env}/search` | search one scope |
| GET | `/api/search` | search the instance |
| POST | `/api/search/reindex` | rebuild the index; export-level read claims |
| GET | `/api/export` | streams tar.gz (`transfer:export` + `media:read`; `keys:export` when including keys) |
| POST | `/api/import?mode=` | accepts tar.gz (`transfer:import` + `media:create`, plus `media:delete` in replace mode; archives containing keys also require `keys:import`) |
| POST | `/api/copy` | pulls and imports another silo (`{source_url, source_api_key, mode, with_keys, dry_run, validate, prefer}`; `transfer:copy`) |
| GET / POST | `/api/keys` | list (`keys:read`) / create (`keys:create`); create returns the secret exactly once |
| DELETE | `/api/keys/{id}` | revoke a key (`keys:revoke`) |
| GET / POST | `/api/media` | search (`media:read`) / upload (`media:create`) — see §8.1 |
| GET / PATCH / DELETE | `/api/media/{id}` | asset detail / rename·move·retag (`media:create`) / guarded delete (`media:delete`) |
| GET | `/api/media/{id}/usages` | paginated referrers, claim-filtered (`media:read`) |
| GET / POST | `/api/media/folders` | list / create an empty folder (`media:read` / `media:create`) |
| DELETE | `/api/media/folders` | delete an empty folder (`media:delete`) |
| POST | `/api/media/reconcile` | backfill and repair the catalog (`media:create` + `media:delete`) |
| GET | `/media/{id}` | public asset streaming (pre-D23 `/media/{blobKey}` still resolves) |

**List query encoding:** `?filter=<url-encoded JSON Filter>&sort=-$.updated_at,$.data.title&limit=50&offset=0`. Since D29 both `filter` paths and `sort` keys are RFC 9535 JSONPath over the API response shape (§5.3); the pre-D29 `author.name` / `$id` spellings are rejected. Response: `{"data": [...], "total": n, "limit": ..., "offset": ...}`. The search routes (§5.5) take the same `filter`, `sort`, `limit` and `offset`, plus `q`.

**Optimistic concurrency:** PUT/DELETE require the expected rev (`If-Match: "3"` or `?rev=3`); mismatch → `409` with the current entry. Prevents lost updates from two admin tabs — cheap now, painful to retrofit.

**Errors:** `{"error": {"code": "validation_failed", "message": "...", "details": [...]}}`; validation details use JSON Pointer paths from the validator.

**Auth: claims-based API keys, Shlink-style.** No users or browser sessions: a presented key authenticates a request and its claims authorize individual operations. Claims are deny-by-default. Anonymous collection schema and entry reads remain public within their scope unless the schema sets `"x-silo-auth": true`. When a key is presented, its claims become the visibility boundary and even public collections require the corresponding read claim.

- **Format & storage:** `silo_` + 32 random bytes base64url. Only the SHA-256 hash is stored, as an entry in the `_keys` system collection (§5.4) with label, validated `claims` array, display prefix (`silo_ab12…`), and the usual envelope. Lookup = hash the presented key, exact-match fetch. The plaintext secret exists only in the creation response.
- **Claims:** root `*`; `collections:<project>/<env>/<name>:create|delete|schema:read|schema:update|access:update|entries:create|entries:read|entries:update|entries:delete`; `media:read|create|delete`; `keys:read|create|revoke|export|import`; and `transfer:export|import|copy`. Each segment (`project`, `env`, `name`) independently supports `*` wildcards (e.g. `collections:acme/*/*:entries:read`, `collections:*/prod/*:...`). Action wildcards are invalid.
- **Non-escalating delegation:** `keys:create` permits minting a key only when every requested claim is already covered by the caller. A segment wildcard can delegate matching named segments; named segments cannot widen to wildcards.
- **No legacy translation:** stored role/collection-allowlist key records are rejected rather than upgraded implicitly.
- **Presets:** `read`, `write`, `manage`, `root` — a ladder, each including the one before it. `read` is `schema:read` + `entries:read`; `write` adds the three entry mutations; `manage` adds collection lifecycle (`create`, `schema:update`, `access:update`, `delete`); `root` is `*`. Non-root presets also carry media claims (`media:read`, plus create/delete from `write` up). A preset expands over one or more `project/env/collection` targets and is otherwise just a claim set — nothing is stored on a key but its claims.
- **Bootstrap:** on first boot with no keys, silo generates a root (`*`) key and prints it to stderr exactly once, boxed under the silo wordmark on a terminal and as flat ASCII when redirected. Locked out? `silo keys create --preset root` on the host works directly against the data dir.
- **Revocation** = deleting the key entry. No expiry and no `last_used_at` in v1 (tracking last-use would turn every request into a storage write, which the fs adapter pays for dearly).
- The UI stores each saved server's key in `localStorage` (`silo_servers`), verifies it with `GET /api/session`, and sends it as a header on every request; no cookies, so no CSRF surface. Any `401` returns the UI to the server manager.

### 8.1 Media: catalog, folders, search, and reference integrity (D23)

Media stays **instance-global** — one library for the whole server, not per
project/env — and `media:read|create|delete` stay unscoped. Folders organize;
they do not authorize.

**Catalog.** Every asset is a `_media` document in `Scope.System`, id = a ULID:

```json
{
  "filename": "hero.png",
  "folder": "/marketing/launch",
  "blob_key": "01J8XQ4Z8K9M2P3R5T7V9X1B3D.png",
  "size": 20481,
  "content_type": "image/png",
  "hash": "e3b0c442...",
  "state": "active",
  "tags": ["hero"]
}
```

`blob_key` is a stored field, so the policy that generates it is one function
and can change without touching the record shape. Folders are metadata: the
key carries no directory component, so moving an asset writes one field and
performs no object-store work — no S3 copy-and-delete, and the archive's flat
`media/` layout (§7.1) is unchanged, so D23 needs no `format_version` bump.

**Folders** follow D20's existence rule in both halves: a folder exists when it
was created explicitly (a `_media_folders` document, id a ULID, `path` in the
data because a `/`-bearing path is not a safe path segment) **or** when some
asset names it. Without the explicit half a folder could not be made before
something was filed into it — the exact gap D20 found with empty projects.

**Search** is the existing Query AST over `_media`: `contains` on `filename`
for `?q=`, `eq` on `folder`, `contains` on `content_type` for `?type=`,
membership on `tags`. No new op, so §5.3's "every op is forever" cost is zero,
and paging plus `total` come from `Storage.list` unchanged.

**References.** Entries name an asset by id — `silo://media/<ulid>` — never by
path, which is what lets a rename leave every entry alone. Extraction is
**structural**, not schema-driven: `MediaRefs.extract` walks the whole `data`
value and collects every string that parses as a reference, regardless of what
the schema says, because §7.2 lets an archive carry `content/<collection>/`
with no schema at all and validation is off by default on import. A
schema-driven walk would find nothing there and a missed reference deletes a
live file. Over-capture (a free-text field holding a literal reference string)
blocks a delete: visible and recoverable. Under-capture orphans: silent. Take
the asymmetry.

Pre-D23 entries hold `/media/<blobKey>`; those are **dual-read** into the token
`blob:<blobKey>` and counted as usages, so a partially backfilled instance
still refuses to delete a referenced file. `silo media reconcile` backfills
catalog records for blobs uploaded before D23, rebuilds usages from entries,
and reports orphan blobs.

**Deletion** is a saga in `Service`, under `writeMu`, because the catalog and a
remote object store cannot share a transaction:

1. Count usages for the asset's id **and** its `blob:` token. Non-zero → `409`.
2. Mark the asset `state: "deleting"` and commit that.
3. Delete the blob.
4. Delete the catalog record.

A crash between 3 and 4 leaves an asset in `deleting`; startup retries the
idempotent blob delete and finishes. `Service` refuses to create a *new*
reference to an asset in `deleting`, so the window cannot be re-entered.
Import does **not** run that check — §7.2 is fidelity-first and validation is
opt-in, so an archive is never rejected for naming an asset it also carries.

**The abort.** A blob delete that fails *permanently* — rotated credentials, a
changed bucket policy — would otherwise strand the asset in `deleting`
forever: unusable, refusing new references, with no operator path out. So
`silo media reconcile` **attempts** the deletion and, if that attempt throws,
returns the asset to `active` and reports it. This is the reverse of the
saga's last step, not a force-delete, and it does not reopen D21.

A blob delete that fails returns **`500 media_delete_stalled`** rather than a
bare internal error: the asset is in a recoverable state, and the body names
it (`media_id`, `blob_key`, the underlying `reason`, and `remedy:
"silo media reconcile"`). An operator driving the API rather than reading the
server's startup log would otherwise have no way to know the asset is staged,
or that a command exists to un-stage it. It is deliberately not a `409` —
`media_in_use` is a refusal the caller fixes by editing entries, this is a
storage failure the caller fixes by fixing the blob store, and a client should
be able to tell the two media-delete outcomes apart by code alone.

Reconcile judges by the *attempt*, never by whether the blob is still present:
a crash between steps 2 and 3 leaves the bytes in place too, and that case must
**complete** rather than reverse. Only an actual failure distinguishes
"interrupted" from "impossible". Startup, by contrast, only ever retries —
one failure is not evidence the operation cannot succeed, and reversing a
deletion is an operator decision, not a boot-time one. Startup therefore counts
failures instead of throwing, because a misconfigured blob store must not stop
the server booting over a deletion someone staged days ago.

There is **no force-delete**. The `409` always reports the total count, and
enumerates only the referrers the calling key may read: media is
instance-global but referrers are scoped, so a key confined to one project must
learn that a file is in use without learning where. The remainder is reported
as a count only.
