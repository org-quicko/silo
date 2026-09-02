# HTTP API

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 8. HTTP API

Hono web framework on Bun. JSON everywhere. Admin UI served at `/`; API under `/api` — no URL versioning (D13): breaking API changes are release-note events tied to binary upgrades, and the data format is versioned independently via `format_version`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | liveness + version |
| GET | `/api/session` | authenticated key label, prefix, and effective claims |
| GET / POST | `/api/projects` | list projects as `{id, name}` (filtered by claims) / create one. `id` is the record's ULID; `name` is what every path addresses (D51) |
| PATCH | `/api/projects/{project}` | rename (`{name}`), bound to `?expected_id=`, previewable with `?dry_run=true` (`RenamePermissions` at `{project}/*/*`, at **both** names — D51) |
| PATCH | `/api/projects/{project}/envs/{env}` | rename an environment, same shape and reach `{project}/{env}/*` (D51) |
| DELETE | `/api/projects/{project}/envs/{env}` | delete scope and its collections (`?force=true`, which also requires `entries:delete` across the scope — D37) |
| GET / POST | `/api/projects/{project}/envs/{env}/collections` | list / create (body: `{name, schema}`); listed items carry `id` since D51 |
| PATCH | `/api/projects/{project}/envs/{env}/collections/{name}` | rename a collection, and repoint every `$ref` to it — additionally requires `collections:schema:update` on **every referring collection** (D51) |
| GET / PUT / DELETE | `/api/projects/{project}/envs/{env}/collections/{name}/schema` | schema fetch / update / delete (`?force=true` also requires `entries:delete` — D37) |
| GET / POST | `/api/projects/{project}/envs/{env}/collections/{name}` | list (query below) / create |
| GET / PUT / DELETE | `/api/projects/{project}/envs/{env}/collections/{name}/{id}` | PUT is full replace |
| GET | `/api/projects/{project}/envs/{env}/collections/{name}/search` | search one collection (§5.5) |
| GET | `/api/projects/{project}/envs/{env}/search` | search one scope |
| GET | `/api/search` | search the instance |
| POST | `/api/search/reindex` | rebuild the index; export-level read claims |
| GET | `/api/export` | streams tar.gz (`transfer:export` + `media:read`; `keys:export` when including keys) |
| POST | `/api/import?mode=` | streams in a tar.gz — a raw body, or a `multipart/form-data` `file` part (`transfer:import` + `media:create`, plus `media:delete` in replace mode; archives containing keys also require `keys:import`) |
| POST | `/api/copy` | pulls and imports another silo (`{source_url, source_api_key, mode, with_keys, dry_run, validate, prefer}`; `transfer:copy`) |
| GET / POST | `/api/keys` | list (`keys:read`) / create (`keys:create`); create returns the secret exactly once |
| DELETE | `/api/keys/{id}` | revoke a key (`keys:revoke`, **and** the authority to have minted it — D37) |
| GET / POST | `/api/media` | search (`media:read`) / upload (`media:create`) — see §8.1 |
| GET / PATCH / DELETE | `/api/media/{id}` | asset detail / rename·move·retag (`media:create`) / guarded delete, `?force=true` to delete over a live reference (`media:delete` plus `entries:update` at the scopes it reaches — D48, D49) — see §8.1 |
| POST | `/api/media/delete` | bulk delete (`{ids, force}`, up to 100), always `200` with per-id outcomes (`media:delete`, force as above — D48, D49) — see §8.1 |
| POST | `/api/media/purge` | empty the whole library (`{confirm: "purge", force?}`), always `200` with per-id outcomes plus a folder count (`media:delete`, force as above — D49) — see §8.1 |
| GET | `/api/media/{id}/usages` | paginated referrers, claim-filtered (`media:read`) |
| GET / POST | `/api/media/folders` | list / create an empty folder (`media:read` / `media:create`) |
| PATCH | `/api/media/folders` | rename or move a folder (`{from, to, merge?}`), and every asset and descendant folder within — refuses on collision unless `merge: true` (`media:create`, D49) |
| DELETE | `/api/media/folders` | delete a folder — empty only by default, or `?recursive=true` for everything inside it, `?force=true` as above (`media:delete`, D23/D49) |
| POST | `/api/media/reconcile` | backfill and repair the catalog (`media:create` + `media:delete`) |
| GET / PUT | `/api/media/storage` | where the library keeps its bytes, read and changed (`media:configure`) — see §8.2 |
| GET / PUT | `/api/media/settings` | where media URLs point and what may be uploaded (`media:configure`) — see §8.3 |
| GET | `/api/settings` | every other table of `silo.toml`, with what is in force and what a restart is owed for (`settings:configure`) — see §8.4 |
| PUT | `/api/settings/{table}` | rewrite one of them (`settings:configure`) |
| GET | `/media/{id}` | public asset streaming (pre-D23 `/media/{blobKey}` still resolves) |
| GET | `/api/plugins` | plugin grants, state, the gap between requested and granted, what each package `contributes`, and the author's reason for every claim (`plugins:read`) |
| GET | `/api/plugins/{name}` | one grant; carries `ETag: "<rev>"` for the mutations below |
| PUT / DELETE | `/api/plugins/{name}/grant` | approve or narrow (body is the **complete** granted set; omitted means everything the package says it **requires**) / withdraw (`plugins:grant`, `If-Match` required) |
| POST | `/api/plugins/{name}/enable` · `/disable` | start or stop it **now** (`plugins:enable`, `If-Match` required); every view carries a `runtime` block, which replaced `restart_required` (D39) |
| PATCH / DELETE | `/api/plugins/{name}/config` | pin an [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396) merge patch over `silo.toml`'s block / clear it (`plugins:configure`, `If-Match` required) |
| POST | `/api/plugins/{name}/restart` | tear the worker down and bring it back (`plugins:enable`); writes no record, so no `If-Match` |
| GET | `/api/plugins/{name}/ui` | the plugin's declared admin panel (`plugins:read`, D41). Answered as **JSON** (`{title, entry, html}`) with `nosniff`, `default-src 'none'; sandbox` and `no-store` — never as a document, because this origin also serves the admin SPA, which keeps an API key per configured server in its `localStorage`. Only the admin makes it a document, inside `sandbox="allow-scripts"` with no `allow-same-origin` |
| POST | `/api/plugins/rescan` | re-read `silo.toml` and apply it (`plugins:enable`); reports per plugin rather than refusing on one |
| ALL | `/api/ext/{name}/*` | the routes a plugin declares (D36); see the note below |
| GET | `/api/audit` | authority changes, newest first (`audit:read`); `?subject=` filters to one key id or plugin name |
| GET | `/api/observability` | bounded process-lifetime API, latency, memory/CPU, and local-storage metrics (`observability:read`) |

**List query encoding:** `?filter=<url-encoded JSON Filter>&sort=-$.updated_at,$.data.title&limit=50&offset=0`. Since D29 both `filter` paths and `sort` keys are RFC 9535 JSONPath over the API response shape (§5.3); the pre-D29 `author.name` / `$id` spellings are rejected. Response: `{"data": [...], "total": n, "limit": ..., "offset": ...}`. The search routes (§5.5) take the same `filter`, `sort`, `limit` and `offset`, plus `q`.

**Optimistic concurrency:** PUT/DELETE require the expected rev (`If-Match: "3"` or `?rev=3`); mismatch → `409` with the current entry. Prevents lost updates from two admin tabs — cheap now, painful to retrofit.

**Errors:** `{"error": {"code": "validation_failed", "message": "...", "details": [...]}}`; validation details use JSON Pointer paths from the validator.

**Auth: claims-based API keys, Shlink-style.** No users or browser sessions: a presented key authenticates a request and its claims authorize individual operations. Claims are deny-by-default. Anonymous collection schema and entry reads remain public within their scope unless the schema sets `"x-silo-auth": true`. When a key is presented, its claims become the visibility boundary and even public collections require the corresponding read claim.

- **Format & storage:** `silo_` + 32 random bytes base64url. Only the SHA-256 hash is stored, as an entry in the `_keys` system collection (§5.4) with label, validated `claims` array, display prefix (`silo_ab12…`), and the usual envelope. Lookup = hash the presented key, exact-match fetch. The plaintext secret exists only in the creation response.
- **Claims:** root `*`; `collections:<project>/<env>/<name>:create|delete|schema:read|schema:update|access:update|entries:create|entries:read|entries:update|entries:delete`; `media:read|create|delete`; `keys:read|create|revoke|export|import`; `transfer:export|import|copy`; `plugins:read|configure|grant|enable`; `audit:read`; `observability:read`; and `http:route`. Each segment (`project`, `env`, `name`) independently supports `*` wildcards (e.g. `collections:acme/*/*:entries:read`, `collections:*/prod/*:...`). Action wildcards are invalid.
- **Non-escalating delegation:** `keys:create` permits minting a key only when every requested claim is already covered by the caller. A segment wildcard can delegate matching named segments; named segments cannot widen to wildcards.
- **No legacy translation:** stored role/collection-allowlist key records are rejected rather than upgraded implicitly.
- **Presets:** `read`, `write`, `manage`, `root` — a ladder, each including the one before it. `read` is `schema:read` + `entries:read`; `write` adds the three entry mutations; `manage` adds collection lifecycle (`create`, `schema:update`, `access:update`, `delete`); `root` is `*`. Non-root presets also carry media claims (`media:read`, plus create/delete from `write` up). A preset expands over one or more `project/env/collection` targets and is otherwise just a claim set — nothing is stored on a key but its claims.
- **Bootstrap:** on first boot with no keys, silo generates a root (`*`) key and prints it to stderr exactly once, boxed under the silo wordmark on a terminal and as flat ASCII when redirected. Locked out? `silo keys create --preset root` on the host works directly against the data dir.
- **Revocation** = deleting the key entry, **and every key descended from it** (D38): `POST /api/keys` records `parent_id`, so a minted key cannot outlive the authority that vouched for it. Not a flag — the correct behaviour behind an argument nobody passes is the same as not having it. The response stays 204; `GET /api/audit` names what went. No expiry and no `last_used_at` in v1 (tracking last-use would turn every request into a storage write, which the fs adapter pays for dearly).
- **Revocation is bounded the way minting is (D37):** `DELETE /api/keys/{id}` requires `keys:revoke` **and** that `canDelegate` accept the target key's claims — if you could not have minted a key this powerful, you may not destroy one. Without the bound, the narrowest key holding `keys:revoke` could revoke root and leave the instance with no administrative credential, which is unrecoverable without filesystem access. A key still revokes itself, since a claim list always covers itself. Managed plugin keys are refused separately, naming `silo plugin revoke` (D34).
- **`?force=true` is a second operation, not a modifier (D37):** without it, the collection, environment and project delete routes refuse while content exists, so `collection:delete` alone is an honest ask. With it, the same request erases every entry underneath — asking for no revision — so it additionally requires `entries:delete` at the reach it destroys: the collection, `{project}/{env}/*`, or `{project}/*/*`. Same rule `replace` mode applies to import and to scope copy. Since D36 it also dispatches one `collection.afterDelete` per erased collection, after the write lock is released, carrying how many entries went and whether the scope above it went too — before that it dispatched nothing at all, and an auditing plugin saw entries appear and never saw them go (D37's F6).
- **Every authority change is recorded (D38):** minting and revoking a key, and granting, revoking, enabling or disabling a plugin, append to the reserved `_audit` collection — written by the services, so the offline CLI is in the trail too. Read it with `GET /api/audit` (`audit:read`, carried by `manage` and `root`). There is no write or delete route and no `audit:write` claim: nothing updates an event, so a claim guarding that would imply a capability that does not exist. `_audit` is excluded from every archive, like every other `_`-prefixed collection but `_keys`.
- **Operating metrics are aggregate and low-cardinality:** `GET /api/observability` groups requests by Hono's registered method and route pattern, never by the requested path. It retains process-lifetime counters and sixty one-minute chart buckets, with bounded latency histograms rather than individual requests. Query strings, route parameters, caller identities, bodies, credentials, content and filesystem paths never enter it. Latency percentiles are bucket upper bounds clamped to the slowest request observed, so one never reads above the `max` beside it. Memory and cumulative CPU time are sampled from the process; local directory size and filesystem capacity are cached background probes that do not follow symlinks and stop after 50,000 entries. The data and media directory figures are disjoint — the data walk skips the media subtree when the library is nested inside it, which it is by default. Remote-provider capacity is `null`, not guessed. `observability:read` is carried by `manage` and `root`, is grantable to a plugin, and has no write counterpart.
- **Plugins reach this table in-process (D35):** a plugin's `ctx.fetch` is dispatched against the same Hono app, with its principal attached by the host on the `env` argument under a module-private symbol rather than presented as a header — so `AuthMiddleware` reads it *before* the `--no-auth` branch and every guard below applies unchanged. Two consequences for anyone adding a route: it is a plugin capability the moment it exists, so a route asking for less authority than it exercises is a plugin escalation and not merely a bug (D37); and a dispatched request has **no origin**, so `RequestUtils.getBaseUrl` returns `""` and media references reach a plugin as stored rather than expanded against a host that does not exist. Only `/api/` is reachable — the SPA fallback and `/media/{id}` sit outside the auth middleware entirely. §13.15 of [plugins.md](plugins.md).
- **A default grant is what the package says it requires (D36):** a manifest splits its `permissions` into `required` and `optional`, each entry carrying the author's `reason`, and `PUT .../grant` with no `claims` approves the required half. It read *everything requested* before the split, which is the same answer for a package declaring nothing optional and the wrong one for a package that does — a default approving the optional half would make the word mean nothing. `required` is stored on the record beside `requested`, because this surface acts on the record and never on the filesystem (D38), and the reasons come from the package because they are documentation rather than authority. §13.19 of [plugins.md](plugins.md).
- **Plugins also serve routes of their own, under `/api/ext/{name}/*` (D36):** declared statically in the manifest, gated by `http:route` — which since D36 is **derived** from the declared routes rather than written out by the author — and each declaring `auth: "key"` (any authenticated key) or `"public"` (no credential). silo matches them itself against that list rather than letting a plugin register anything, so a plugin can neither shadow nor reorder a route in this table, and the set is resolved per request — enable, disable, revoke and rescan therefore apply to routes as they do to hooks (D39). A handler runs with **the plugin's** authority and not the caller's, which is why exposure is a claim and why `public` is called out separately: it publishes whatever the plugin was granted at a URL anyone can reach. The caller's `Authorization`, `X-Api-Key` and `Cookie` are withheld from the handler, which receives an id, a label and claims instead. A thrown `ValidationError` or `ForbiddenError` maps to 400/403 through the same `onError` as everything else; a handler that misses `timeout_ms` is a 504 naming `POST /api/plugins/{name}/restart`; a request body is bounded by the route's own declared `body` — text and 1 MiB unless the manifest says `{"kind": "bytes", "max_bytes": n}` up to silo's 64 MiB ceiling (D41) — and **refused** past it rather than truncated, since a plugin cannot tell a body it was not given from one that was never sent. A `bytes` route is handed `request.bytes` and no text. `HEAD` reaches a declared `GET`, as it does everywhere else in this table. §13.18 of [plugins.md](plugins.md).
- The UI stores each saved server's key in `localStorage` (`silo_servers`), verifies it with `GET /api/session`, and sends it as a header on every request; no cookies, so no CSRF surface. Any `401` returns the UI to the server manager.
- **A project, environment or collection can be renamed (D51):** three `PATCH`
  routes taking `{name}`. Authority is `RenamePermissions =
  [collections:create, collections:delete]` at the subject's own reach —
  `{project}/*/*`, `{project}/{env}/*`, or the one collection — checked at
  **both** the old and the new name, so a key scoped to one namespace cannot
  move a project into another. Neither permission suffices alone: `create`
  would let a caller who may only add collections retire an existing name, and
  `delete` would let one who may only remove them introduce a new one on
  content it cannot otherwise write to. A rename is bound to `?expected_id=`,
  because a name-addressed mutation can arrive after the thing it named was
  renamed and something else took the name; a mismatch is a `409`.
  `?dry_run=true` answers the same body and writes nothing.

  **What the response carries is the interesting part.** A rename rewrites claim
  strings — they name these things by name, and they stay that way, because a
  ULID fails the claim grammar's id pattern and ULID claims would be unreadable
  and would break the cross-instance key portability `--with-keys` exists for. So
  the rewrite turns on one distinction: **a literal segment is a reference and is
  rewritten; a wildcard segment is a pattern over names and never is.**
  `collections:*/dev/*:entries:read` means "any project's `dev`" and already
  matches scopes that do not exist yet, which is what independent per-segment
  wildcards are *for* (D19) — so rewriting it to `*/prod/*` would silently change
  authority in every project on the instance, while leaving it alone genuinely
  changes what the key reaches. Both readings are correct and neither is a
  rewrite, so the answer is **disclosure**: the body carries `rewritten_claims`
  and `pattern_affected_claims` separately, the audit `detail` records both, and
  the admin prints both before asking for confirmation. Nothing else in the
  product would ever tell an operator that a key's reach moved without its
  claims changing.

  The rewrite covers `_keys` and `_plugins`, and is **staged**: a
  `_scope_renames` marker carrying the enumerated record ids — a bounded
  worklist, not a re-derived query, which would rewrite the wrong records if a
  new project took the freed name first — written before the first rewrite and
  cleared after the last, replayed by `resumePending` **before plugins load**,
  since a plugin boots on the authority its record holds. The marker doubles as
  a **name reservation**, which is what makes that replay safe to be non-fatal
  the way D23's and D49's resumes are: nothing can have taken the old name in
  the meantime. A plugin whose grant moved is restarted onto it. Completeness is
  a correctness requirement rather than a nicety, because D34 checks `hooks:`
  claims *before* an event crosses into a worker, so a claim the cascade missed
  stops hook delivery with no error anyone sees.

  `silo.toml`'s `[[plugins]] claims` half is **refused rather than rewritten**.
  Effective plugin authority is config ∪ record, so a rename that rewrote only
  the record would leave the file naming a scope that no longer exists — and
  rewriting the file is the thing D34 forbids in as many words: an API able to
  write it is a code-execution primitive wearing a management claim. So the
  rename stops with a `409` naming the blocks and leaves the edit to the
  operator. Fail closed, rather than complete three quarters of an authority
  change.

  A **collection** rename additionally rewrites the schema graph, because
  `$ref`s address collections by name: every referring schema's `$ref` strings,
  self-references included, and the `$defs` keys `SchemaBundler` derives from
  collection names — stripped and re-bundled rather than patched, since the
  bundler regenerates what it owns and would otherwise leave the old key behind
  forever. The whole graph is validated before anything is written, and
  `collections:schema:update` is asked for on every referrer up front rather
  than discovered half way through.

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

The `409` always reports the total count (`usage_count`), and enumerates only
the referrers the calling key may read: media is instance-global but
referrers are scoped, so a key confined to one project must learn that a file
is in use without learning where. The remainder is reported as a count only,
`visible_count` — the **true** number of referrers the key may read, not how
many happened to fit on the `referrers` sample page (D49 audit fix: it used
to be `items.length`, which made `visible_count < usage_count` for any asset
with more referrers than one page holds, readable or not). `visible_count` is
itself counted up to `MediaUsageScopes.EnumerationCap` (2000 rows, the same
force-authority cap described a few paragraphs down) — reused rather than a
second cap of its own — and once a single asset's referrers exceed it,
`visible_capped: true` says the count is a lower bound rather than pretending
to be exact.

**`?force=true` deletes over a live reference (D48).** Only the literal
string `"true"` enables it; anything else is read as absent. Force skips step
1 — the usage check — and nothing else: the rest of the saga, and the write
lock around it, are unchanged. The entries that named the asset are **not
rewritten** — no mass mutation of entry data on a delete — and the usage rows
those entries produced are **not deleted**: they are adapter-owned derived
state that honestly records the entries still hold the reference, and `silo
media reconcile` re-derives them from entries regardless of what a delete did
or did not touch. What changes instead is the read path: a media field whose
reference no longer resolves answers `null` rather than a URL that 404s (see
below).

**Force additionally requires `entries:update` at every scope it actually
reaches (D49).** D48 shipped force gated on `media:delete` alone, reasoning
that the claim was already instance-global and unscoped, so a holder could
already delete any unreferenced file in any project — an acceptance, not a
claim that force grants nothing new. That acceptance did not survive folder
rename, recursive delete and purge arriving together: a force-deleted asset's
referring entries do not have their *stored* value rewritten, but the read
path changes what every one of them *resolves to*, which is a bulk
`entries:update` wearing a `media:delete` claim — the same rule
`ForcedDeletePermissions`, `TransferPermissions.Replace` and
`ScopeCopyPermissions.Replace` already state: a force must additionally hold
the claims for the effects it cascades into. `entries:update`, not
`entries:delete`, because the entry is not deleted and its stored content is
not rewritten — only what one field of it resolves to. `MediaForceDeletePermissions.All
= [entries:update]` lives beside `Claims.ForcedDeletePermissions` for the
reason it does: the admin gates its force affordances on the same list this
enforces.

Unlike the other three force routes, media's reach is **data-derived** rather
than read off the route's own parameters: `RouteAuth.requireForcedMediaDelete`
(async, unlike its sibling `requireForcedDelete`, because it queries usages)
enumerates the distinct `(project, env, collection)` scopes currently
referring to the assets being force-deleted — via `MediaUsageScopes.reach`,
which pages `Storage.listMediaUsages` up to a **2000-row** cap — and requires
`entries:update` on each, checked against the **true** referrer set, never the
claim-filtered one the `409`/per-id body above shows the caller. Filtering
first would let a key force-delete *because* it cannot see the referrers; a
key that cannot read a scope necessarily lacks `entries:update` there too, so
refusing it is the correct and self-consistent outcome. Past the cap, the
distinct-scope reduction is not attempted and force is refused unless the key
holds `*` — silo cannot enumerate everything the operation would break, so
only a key that can do anything may do it.

**The `403` takes the same hidden-versus-visible split the `409` does.** The
check runs against the true reach, so the refusal must not be the one place
that discloses it: it names only the missing scopes the key may already read
(the ones the `409` would have enumerated anyway) and reports the rest as a
bare count, "N scopes this key cannot read". Naming the first missing scope
would have handed a project-confined key exactly the project, environment and
collection names the enumeration above is written to withhold — and would
have leaked them from the alphabetically first hidden referrer, which no
`409` ever shows.

A `Storage.listMediaUsageScopes`
port method would make the cap unnecessary by answering the question exactly
rather than by paging rows; it was not added because port growth needs its
own justification beyond one caller, and a fixed cap with a root fallback is
honest about what it does not know rather than silently wrong. The exposure
this closes is concentrated on plugins: `media:delete` is not on
`PluginForbiddenClaims`, so a plugin already holding it gains
reference-breaking reach with no manifest change and therefore no
`needs_review` re-approval — force alone was never enough of a check on that,
and `entries:update` at the reached scopes now is. No new audit action is
added for it either: `core/audit/audit-action.ts` audits
*authority* changes, and entry and content writes are deliberately not
audited; a force-delete is a content decision like any other media delete, not
an authority one.

**`POST /api/media/delete`** is the bulk sibling, behind the same
`media:delete`: `{"ids": ["id1", "id2"], "force": false}`, capped at 100 ids.
Each id is deleted through the same saga as the single-asset route, in a
sequential loop — never one write lock over the whole batch, since that would
serialize every other media write behind an operator's spring-cleaning. It
**always answers `200`**, never `204` and never a `207`: the request itself
succeeded, and each id's outcome is data the caller reads out of the body
rather than a status code that cannot carry the referrers a partial refusal
needs explaining with.

```jsonc
// POST /api/media/delete
{
  "deleted": ["id1"],
  "failed": [
    { "id": "id3", "code": "media_in_use", "message": "...",
      "usage_count": 4, "visible_count": 2, "visible_capped": false,
      "referrers": [ /* claim-filtered, as above */ ] },
    { "id": "id4", "code": "not_found", "message": "..." },
    { "id": "id5", "code": "media_delete_stalled", "message": "..." },
    { "id": "../x", "code": "invalid_id", "message": "..." }
  ]
}
```

`invalid_id` is what a malformed id becomes: `MediaCatalogStore.asset` runs
`EntryUtils.assertSafeSegment` before it touches storage, which throws for a
path separator, a NUL byte, `.`/`..`, or a segment over 255 bytes. That is a
per-id 4xx condition, not grounds to fail the whole request — a batch that hit
it after already deleting earlier ids would 400 with no `deleted` list to show
for them. `ids` themselves are deduplicated preserving first-seen order before
the loop runs, so `{"ids": ["x", "x"]}` deletes `x` once rather than reporting
a spurious `not_found` for the id its own first pass just removed.

Any error the route does not recognise as one of those four propagates as a
normal `5xx`/`4xx` rather than being folded silently into `failed`.

**`PATCH /api/media/folders`** renames or moves a folder (D49): `{"from":
"/a", "to": "/b", "merge": false}`, behind `media:create` — the same claim
and reasoning as an asset rename/move, since where a thing sits is the same
kind of statement as what it is called. A body rather than a path parameter,
because a folder path contains `/`. It updates the explicit `_media_folders`
record for the folder and every descendant, and `folder` on every asset
within the subtree — no entry is touched and no blob moves, the same D23
property a single asset's rename has always had, one level up. Refuses with a
`409` if `to` already exists, as an explicit record or implied by any asset's
folder, **unless the caller opts in with `merge: true`** (D49 amendment),
which joins the subtree into whatever already sits at `to` instead; refuses
with a `400` if `to` is inside `from` (which would otherwise loop) or if
either path normalizes to root — both guards apply whether or not `merge` is
set. No cap on subtree size — a large rename holds the write lock for as many
record writes as it takes, which is the cost of not inventing a limit that
would leave a large library with no way to rename a folder at all.

**`merge` is opt-in rather than automatic because it is genuinely
irreversible.** Once two subtrees have joined, a rename back cannot separate
them again — which asset came from which no longer means anything, so the
default stays a refusal and merging is a deliberate second step. With it, the
write proceeds into a folder that may already hold files, including one with
the same filename as something already there, and that is legal on purpose:
a filename is display metadata, never addressing (D23) — assets are
referenced by stable id and blob keys are flat — so two files both named
`logo.svg` in one folder after a merge is the same ordinary state the
library already permits everywhere else. Nothing about this route should
ever be "hardened" into refusing that.

The **depth ceiling still applies to the whole subtree regardless of
`merge`**, checked on its deepest path before anything is written: a
descendant's rewritten path is stored as a field and never passes back
through `MediaPaths.normalizeFolder`, so a move under a deeper parent would
otherwise store paths past `MaxDepth` that no upload could have created.

**The rename is staged, because there is no transaction across the record
writes.** A `_media_folder_moves` record naming `from` and `to` is written
after every refusal above and before the first record write, and cleared
after the last, so the only states a crash can leave are "no marker, nothing
started" and "marker, possibly half-applied" — never half-applied with no
record that it was. `MediaFolderMoveService.resumePending` replays any marker
at the next start, beside the staged-deletion resume above, and the replay is
idempotent by construction: it selects by "still within `from`", so a subtree
already partly moved converges instead of doubling, and a marker whose move
had in fact completed clears without writing anything. A marker naming
nothing is dropped rather than retried forever. Failures are counted, never
thrown — a rename staged days ago must not stop the server booting, the same
judgement the deletion resume makes. The marker is carried in an export for
the reason the rest of the catalog is: an archive taken mid-rename holds the
half-moved subtree either way, and carrying the marker is what lets the
destination converge on the state the source will reach at its own next
start, rather than restoring a split nothing has a record of.

The staging is what makes recovery automatic; the write order is what makes
a crash non-destructive in the first place. Each folder record write is a
`putFolder` (a fresh id, at the moved
path) followed by a `deleteFolder` (the old id) — put before delete,
deliberately, so a crash between the two leaves *both* records standing
rather than neither: a harmless duplicate `MediaFolderService.list` already
collapses through a `Set` on the read side, never a folder that silently
stopped existing. A crash is the *only* thing that may leave such a
duplicate: the put is skipped whenever the destination path already holds an
explicit record — reachable only under `merge`, since otherwise `to` would
not exist — because the record the delete would be racing already stands,
so there is no window to protect and the put would only duplicate it.
Without that skip, every merge into a destination with explicit records of
its own left one behind permanently, and the `Set` that makes a crash's
duplicate harmless is also what guaranteed nobody would ever see it (D49
audit fix). `merge: true` is therefore a deliberate operation rather than
the recovery mechanism — the saga is that — though it remains how an operator
finishes a move whose marker the resume could not apply, and the reason a
replay meets no collision it cannot pass. Each asset write is a single `putAsset` to its own
unchanged id, never a delete followed by a put, so it carries no equivalent
loss window; a crash mid-loop there only ever splits the subtree's assets
between `from` and `to`, both of which already exist per D20's existence
rule the moment either name is used by anything. Either way, a crash leaves
the rename looking *unfinished*, never *lost* — and a plain retry then
refuses on exactly the collision the crash created, which is the scenario
`merge: true` exists to finish. It is not a repair tool bolted on after the
fact; it is the same opt-in an operator reaches for on purpose, run once
against whatever a crash happened to leave behind. That is also why capping
subtree size to make the rename atomic was never the fix worth building: it
would still leave an operator with no way to rename a folder bigger than the
cap, where `merge` costs nothing extra and resolves the interrupted case for
free.

**`DELETE /api/media/folders?recursive=true&force=true`** takes a folder
delete recursive (D49). Without `recursive`, behaviour is exactly what it was
before this decision: `MediaFolderService.delete` refuses with a `409` while
anything is inside, and an empty folder deletes trivially — D23's absolute
"a folder delete must never route around the reference guard" premise was
already reversed by D48 making that guard opt-in force everywhere else it
applies, and D49 is what makes the recursive path *coherent* rather than what
makes the non-recursive one *obsolete*. `force=true` without `recursive=true`
is a `400 ValidationError`, not a silently ignored flag: without `recursive`
nothing in the request deletes anything, so there is nothing for `force` to
force, and accepting the flag while dropping it would be indistinguishable
from a verified request in the response — the same reasoning D32 already
states for a source that cannot honour `--integrity` (D49 audit fix; this
route used to return before `force` was even read). With `recursive`, every asset in the
subtree is deleted through the same saga a single-asset delete uses
(`MediaDeletionService.delete`, so the blob delete and
`MediaDeleteStalledError` both still apply), via the same per-id outcome loop
`POST /api/media/delete` runs — factored into one shared `MediaDeleteBatch`
rather than a second failure shape — and only once every asset in the
subtree comes back gone are the folder records (the subtree's own and every
descendant's) removed. `force` is read the same as everywhere else and needs
the D49 authority check above, computed once over every id the subtree
enumerates. The response is `200` with the same `{deleted, failed}` shape
`POST /api/media/delete` answers, plus `folders_deleted`: an asset that comes
back `media_in_use` means the folder is not actually empty, so the count is
`0` and the records stay, reported honestly rather than deleted out from
under what still names them.

**`POST /api/media/purge`** empties the whole library (D49): `{"confirm":
"purge", "force": false}`, behind `media:delete`. The literal confirmation
word is required — a missing or wrong value is a `ValidationError` — as the
cheapest insurance against a stray or replayed request emptying a library
with no undo. Every catalog asset is deleted through the same saga
(`MediaDeletionService.delete`) and the same `MediaDeleteBatch` outcome loop,
but `MediaPurgeService` **pages the catalog** in fixed-size batches rather
than calling `allAssets()` the way `MediaFolderService` does — deliberately
not that pattern, since purge's whole point is a library too large to hold
in memory at once. Its offset advances by each page's *surviving-failure*
count, not its size: a plain `offset += batchSize` scan over a table the
same request is deleting rows from would silently skip whatever a
successful page's deletions shifted past the next boundary, and advancing by
the failures left behind is the exact correction, landing the next page
exactly on the first row this pass never touched. "Surviving" excludes
`not_found`: that row is already gone before the page that reports it, so
counting it toward the offset would skip one untried asset past it the same
way a successful delete's row does (a narrow bug the offset arithmetic could
only hit under a concurrent delete racing the scan, fixed in the same change
that made the force check below pre-flight, D49 audit fix).

`force` needs the D49 authority check **once, over the whole catalog's id
set, before the first delete runs** — never per page. A per-page check would
let earlier pages finish deleting, blobs included, before a later page's
refusal aborted the request with a `403` whose body has nowhere to record
what already vanished (D49 audit fix; the other three force routes —
`media-routes.ts`'s single and bulk delete, `media-folder-routes.ts`'s
recursive delete — already complete their authority check over the whole id
set before any mutation, and purge now matches them). Purge, unlike those
three, has no caller-supplied or route-derived id list to check against, so
it pages the whole catalog once, collecting every id, before running
`requireForce` over that complete set through the same `MediaUsageScopes`
path and the same 2000-row cap rule the other three routes use — past the
cap, force requires `*`, which for a purge-sized reach is an honest cost, not
a defect, since forcing past the entire library's referrers is a near-root
act already. Unforced purge is unaffected: it needs no authority check at
all and pages exactly as it always did. Unforced, an in-use asset is a
per-id `media_in_use` failure and
everything else still deletes — "delete everything you can, report what
refused," the same posture bulk delete already takes. The response is `200`
with `{deleted, failed, folders_deleted}`, the same shape the recursive
folder delete answers with, for the same reason: a partial purge needs
somewhere to report what refused, and every explicit folder record is removed
only once nothing failed.

**A media field resolves to `null` when its reference does not resolve
(D48).** Before D48 a reference was rewritten from the id alone, so a
force-deleted asset left an entry answering with a link that 404s — the delete
became visible only when something tried to fetch the file. `MediaLinkResolver`
now consults the catalog for every reference in a response, not only in
`store` mode: **one `catalog.findAsset(id)` point read per distinct reference**
in the payload, in a loop, capped at 200 — never one filtered query over the
whole catalog. That query shape was tried and reverted: `FsEntryStore.list`
reads and parses every document in `_media` before filtering anything, which
is the O(n)-per-query character §6.3 commits the fs adapter to by design, so a
single `in` lookup over `$.id` would cost the entire catalog on every response
holding even one reference; on SQLite it is two statements, because `list`
always runs a `SELECT COUNT(*)` the caller never uses. A reference the catalog
no longer holds answers `null`, in place: a single field is `null`, and an
element of a media array is `null` in that slot rather than removed, so an
array's length never depends on whether every reference in it still resolves.
A reference that was never looked up at all — past the resolver's lookup cap,
or a pre-D23 `blob:`/`/media/<blobKey>` legacy value, which is never looked up
— resolves exactly as it always has; only an id the catalog was actually asked
about and came back empty for is ever `null`. This costs `EntryUtils.
toApiResponse` a property D46 bought it: the lookup used to run only in
`store` mode and now always runs on all five read paths that call it
(`entries-routes.ts` ×4, `search-routes.ts` ×1), so the ordinary `server`-mode
response now pays one point read per distinct reference, capped at 200, that
it used to pay zero for. That is the honest price of a `null` the caller can
trust rather than a link that 404s. The lookup still runs once per response
before entries are mapped, so `toApiResponse` itself stays synchronous.

**The reference itself is not rewritten, and that makes the `null` dangerous
to echo back.** A force-delete leaves the entry's stored value exactly as it
was — the reference and the usage row it produced both survive, and `silo
media reconcile` would re-derive that usage row from the entry regardless of
what the delete did or did not touch. Only the *read* path answers `null`. A
client that fetches such an entry, edits an unrelated field and PUTs the whole
object back therefore sends `null` for the media field, and `MediaRefs.
canonicalize` passes `null` through unchanged on the way in — the reference and
its usage row are destroyed for real, this time by the client's own write.
Worse, for the ordinary media schema, `{"type": "string", "x-silo-type":
"media"}`, `null` **fails validation** in both RJSF's ajv8 and the server's own
validator, so a user editing a field they never touched hits an error on the
one they did not. The admin's fix lives at the write path: a media field that
reads back `null` is **omitted** from what the form submits, never sent as
`null`. An optional field then saves cleanly, and a required one fails with an
honest "required" error on that field — which is the truth, since the entry
has lost a file it is required to have.

### 8.2 Media storage: reading and changing where the bytes go (D45)

`GET`/`PUT /api/media/storage`, behind **`media:configure`**. The rationale, the
ordering and the rollback are §6.4 in
[storage.md](storage.md); this is the wire shape.

Both verbs ask for one claim rather than a read/write pair. The read is not the
harmless half: it names the bucket, the endpoint and the access key id the
instance authenticates with.

```jsonc
// GET /api/media/storage
{
  "file":     { "driver": "s3", "bucket": "silo-media", "region": "ap-south-1",
                "access_key_id": "AKIA…", "secret_access_key_set": true },
  "in_force": { "driver": "s3", "bucket": "from-the-environment", "region": "ap-south-1",
                "access_key_id": "AKIA…", "secret_access_key_set": true },
  "drivers":  ["fs", "s3"],
  "overrides": [{ "field": "bucket", "env": "SILO_BLOB_S3_BUCKET" }],
  "config_path": "/srv/silo/silo.toml",
  "writable": true
}
```

**`file` and `in_force` are both reported**, because the page edits a file and a
file is the third thing consulted (flags > `SILO_*` > file > defaults, §10).
`overrides` names each field the file does not decide, with `env` set when the
source can be named exactly; no `env` means a flag, or a file edited since the
process started. The **fs media path derivation is not an override** — unset
means "follow the data dir", so `<data dir>/media` appearing in `in_force` is
the file being obeyed rather than overruled.

`drivers` is what *this process* can open, so a provider plugin's blob driver
(§13.7) is offered without the admin carrying a second copy of the list.
`writable` is false when the file cannot be written, and `read_only_reason` says
which of the two it is: the process was started with no config file, or the path
is one this server has no write access to (D50). The admin prints that sentence
as it stands. Either way a `PUT` is a `400` saying so, and never a guess at a
path. The probe is advisory — permissions change between a `GET` and a `PUT` —
so a refusal at write time is reported the same way, naming the path and the
remedy rather than answering `500 internal error`.

`PUT` takes the same field names as a **whole document**, not a patch — the
fields are few and all on one screen, so a `PUT` of what was read cannot leave a
stale value behind by omission:

```jsonc
{ "driver": "s3", "bucket": "silo-media", "region": "ap-south-1",
  "endpoint": "https://…", "access_key_id": "AKIA…",
  "secret_access_key": "…",        // omitted keeps the file's; "" clears it
  "force_path_style": false }
```

`secret_access_key` is the one exception, and it has to be: the read never
returned it, so a caller sending back what it read has nothing to send. It is
also merged over **the file's** value rather than the config in force, so a
secret supplied through `SILO_BLOB_S3_SECRET_ACCESS_KEY` is never copied into
`silo.toml` by somebody who came to change the region.

### 8.3 Media settings: where URLs point, and what may be uploaded (D46)

`GET`/`PUT /api/media/settings`, behind the same **`media:configure`** claim as
§8.2 and separate from it on purpose. They are two tables with two failure
modes — a bad allowlist is a typo, a bad bucket cannot be opened at all — and
one route would make correcting the first depend on the second still working.

```jsonc
// GET /api/media/settings
{
  "file":     { "base_url": "https://cms.example.com", "base_url_target": "server" },
  "in_force": { "base_url": "https://cms.example.com", "base_url_target": "server",
                "extensions": ["jpg", "png", "pdf"] },
  "overrides": [],
  "default_extensions": ["jpg", "jpeg", "png", "…"],
  "config_path": "/srv/silo/silo.toml",
  "writable": true
}
```

`file` is a **partial** and `in_force` is not: a `[media]` naming only
`base_url` has not also decided the extension list, and reporting silo's
defaults as though the file had asked for them would be the same lie §8.2
avoids for the fs media path.

**`base_url_target` decides what the URL under `base_url` looks like**, and the
two are not interchangeable:

| target | a media field resolves to | who serves it |
|---|---|---|
| `server` (default) | `<base>/media/<id>` | silo, with its ETag and 304 handling |
| `store` | `<base>/<blob key>` | the bucket or a CDN over it, with silo out of the read path |

`store` is the shape an email client needs, since it cannot authenticate and
will not follow silo's cache headers; it requires the bucket to be publicly
readable. It also costs one catalog lookup per response — a blob key lives on
the record, not in the reference — which is why the resolution happens once
per response before entries are mapped rather than inside `toApiResponse`
(§8.1's purity is what makes that mapping cheap).

Since D48 the catalog is consulted in `server` mode too, for a different
reason: not to find a blob key, but to tell a reference that still resolves
from one that does not. An id past `MediaLinkResolver`'s lookup cap was never
asked about and falls back to silo's own origin rather than to `base_url`,
exactly as it always has: the CDN has never heard of `/media/<id>`, so a link
rooted there would 404. An id that **was** asked about and the catalog no
longer holds — most often a force-delete (§8.1, D48) — answers `null`
instead, in both targets. Those are the only two outcomes a lookup miss can
mean, and a client cannot tell one from the other unless the server does not
paper over the difference with the same fallback for both.

`PUT` takes the whole table. Unlike §8.2's secret, **an omitted field is
cleared, not kept** — nothing here is write-only, so the form always holds the
real value and a missing one can only mean it was removed.

```jsonc
{ "base_url": "https://cdn.example.com",   // "" clears it; must be absolute http(s)
  "base_url_target": "store",
  "extensions": ["jpg", "png", "pdf"] }    // ["*"] accepts everything; [] is a 400
```

The allowlist is enforced on the **filename extension**, not the declared
content type: a multipart part carries whatever `Content-Type` the client chose,
so trusting it would let the caller decide whether the caller is allowed. It is
enforced on `PATCH /api/media/{id}` too — a rename is the other way a filename
enters the library — and before any bytes are written, so a refused upload
leaves nothing behind. Only the last extension counts, so `invoice.pdf.exe` is
an `.exe`.

Neither field reaches backwards. Changing `base_url` does not rewrite a URL
already sitting in a sent email, and narrowing the allowlist does not remove
files already in the library.

### 8.4 Server settings: the rest of the config file (D47)

`GET /api/settings` and `PUT /api/settings/{table}`, behind
**`settings:configure`**. One read for every section, because the page draws
them together and four requests to fill one screen is four ways for it to come
up half-formed; one write per section, because they are separate tables with
separate failure modes.

```jsonc
// GET /api/settings
{
  "sections": [{
    "table": "log",
    "title": "Logging",
    "summary": "How much the server writes down, in what format, and where.",
    "fields": [
      { "key": "level", "type": "enum", "values": ["debug", "info", "warn", "error", "silent"],
        "env": "SILO_LOG_LEVEL", "label": "Level" },
      { "key": "file", "type": "string", "env": "SILO_LOG_FILE", "restart": true, "label": "File" }
    ],
    "file":     { "level": "warn" },
    "in_force": { "level": "warn", "format": "text", "requests": false },
    "overrides": [],
    "writable": true,
    "restart_pending": []
  }],
  "config_path": "/srv/silo/silo.toml",
  "writable": true,
  "restart_pending": false
}
```

`writable` and `read_only_reason` are §8.2's, and mean the same thing here: a
file this process cannot write makes every section read-only, and the reason is
the sentence the page shows.

**The field list travels with the answer.** It is the spec `ConfigSections`
holds, so a setting added there appears on the page with its label, its type and
its restart behaviour intact. A form built from a second list written out in the
admin goes stale one release after somebody adds a field to only one of them.

`file` versus `in_force` is §8.2's split, and `restart_pending` is what this
route adds to it. Not every setting can be applied to a running process: a log
level is a threshold read on every line, while a tokenizer rebuilds an index at
boot and a log file is a handle opened once. So a field carries `restart: true`
or it does not, and a saved value the process has not adopted is reported in
`restart_pending` and **left out of `in_force`** rather than echoed back into it.

```jsonc
// PUT /api/settings/log   ->  the whole view, since a save can change what another section reports
{ "level": "debug", "requests": true }
```

The body is the whole table, not a patch. An **unknown key is refused**, not
dropped: a typo that saves cleanly and does nothing is the one outcome a caller
cannot tell from success. An omitted key means the file does not decide that
field, which is what keeps an unset `[log] file` meaning "the console".

Two limits are deliberate and are reported rather than hidden:

- **`[storage]` is `writable: false`.** Changing the driver or the data
  directory does not configure this instance, it names a different one, and a
  `PUT` is a 400 that says so.
- **`[auth] disabled` may be set to `false` and never to `true`.** An API that
  can switch off the authentication protecting it is a lock whose key opens
  itself. The other direction is always safe: an instance running with auth off
  is one where every caller is already root.

`[blob_storage]` and `[media]` are not here — they have §8.2 and §8.3, where a
save applies live and rolls back. `[[plugins]]` is not here either, and that one
is not an omission: it decides what code runs, so it goes through the install
API and the grant model (§13.21) rather than a text field.



The response is the view a fresh `GET` would give, already reflecting the applied
change: the running server is repointed before it answers. Refusals are `400`
(unknown driver, a body that is not a configuration, a configuration the driver
cannot be opened with, no config file to write, or a config file the filesystem
refused the write to), `403` without the claim.
Changes are appended to the audit trail as `media.configure`.
