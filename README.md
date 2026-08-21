# silo

A small, standards-based headless CMS. Define collections in JSON Schema, get an
admin UI with generated forms and a REST API, and swap out any part of it.

silo is one TypeScript process on [Bun](https://bun.com) with a handful of
dependencies. It stores content as plain JSON documents in SQLite or in flat
files, serves its own React admin UI, and keeps every moving part behind an
interface you can replace. There is no proprietary field language, query
language, or file format anywhere in it: what silo stores is what any other tool
can already read.

> **Status: pre-1.0 and under active development.** The HTTP API and the
> on-disk layout can still change between releases. Data is stamped with a
> `format_version`, so silo refuses to open or import anything it does not
> understand rather than misreading it.

## Contents

- [Why silo](#why-silo)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Admin UI](#admin-ui)
- [Configuration](#configuration)
- [Running as a service](#running-as-a-service)
- [CLI](#cli)
- [HTTP API](#http-api)
- [Authentication and claims](#authentication-and-claims)
- [Portability](#portability)
- [Deployment](#deployment)
- [Development](#development)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

## Why silo

- **Simple.** One process, one data directory, nothing to stand up beside it. The
  entire model is projects, environments, collections, and JSON documents, and
  there are no user accounts or sessions to administer: an API key carrying
  explicit claims is the whole auth story. You can hold silo in your head after
  one read of this page.
- **Lightweight.** Six runtime dependencies on top of Bun. SQLite comes from the
  runtime itself, media goes to local disk by default, and the admin UI is a
  small React bundle the server hosts on its own. No database server, no cache,
  no queue, no search cluster. It runs comfortably on the cheapest instance your
  host sells, and compiles to a standalone binary.
- **Standard.** Collections are plain [JSON Schema draft 2020-12] documents,
  validated full-spec by Ajv 2020. Entries are plain JSON. Transport is plain
  REST over HTTP, ids are ULIDs, timestamps are RFC3339 UTC, archives are
  tarballs, media speaks the S3 API, and configuration is TOML plus environment
  variables. Every one of those is something your tools already understand, so
  there is nothing here to write a parser or a client library for.
- **Customizable.** The core defines interfaces and reaches around none of them.
  Storage is SQLite, flat files, or your own driver. Media is local disk or any
  S3-compatible bucket (AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces).
  Access is composed per key from fine-grained claims with per-segment
  wildcards, rather than picked from a fixed list of roles. `x-silo-*` keywords
  inside a schema drive how the admin UI renders and protects a collection. The
  admin UI itself is an ordinary client of the public API, so you can extend it,
  fork it, or replace it with your own.

Portability is what those four add up to. Because a collection is a standard
schema and an entry is a standard document, every instance can be exported,
backed up, diffed, migrated between storage drivers, or pulled straight out of
another running silo, with one command and no lossy conversion step. The
filesystem driver's on-disk layout *is* the export format, so an fs-backed
instance is a live backup: copy it with `cp`, replicate it with `rsync`, review
it in git.

## Quick start

### Homebrew

```sh
brew install org-quicko/tap/silo
silo serve
```

`brew services start silo` runs it in the background instead, keeping its data
under Homebrew's prefix (`$(brew --prefix)/var/silo`) rather than in whatever
directory you started it from.

### dnf (Amazon Linux 2023, RHEL, Fedora)

```sh
sudo curl -fsSL -o /etc/yum.repos.d/silo.repo https://org-quicko.github.io/silo/silo.repo
sudo dnf install silo
```

The package installs a `silo` system user, a config at `/etc/silo/silo.toml`, a
data directory at `/var/lib/silo`, and a systemd unit. Nothing starts on
install; `sudo systemctl enable --now silo` does. On first start silo prints a
root API key to the journal, once:

```sh
sudo journalctl -u silo | grep -A2 'root API key'
```

Packages and the repository index are both signed, and the `.repo` file turns
on `gpgcheck` and `repo_gpgcheck`, so dnf verifies both.

### Prebuilt binaries

Every [release](https://github.com/org-quicko/silo/releases) has an archive for
macOS and Linux on x64 and arm64. Each holds a single self-contained `silo` —
the admin UI is inside the executable — so unpacking it somewhere on your
`PATH` is the whole installation.

Releases are checksummed and signed — `SHA256SUMS` and two signatures over it
(Sigstore keyless, and GPG) are attached alongside each release, with the
verification commands in that release's notes.

### Docker

```sh
docker build --pull -t silo .
docker run -p 8090:8090 -v silo_data:/data silo
```

On first run silo generates a root API key and prints it **once** to the
container logs (`docker logs`). Store it: you need it to connect the admin UI at
<http://localhost:8090>.

### From source

Requires Bun 1.3 or newer.

```sh
bun install                    # every workspace: server, shared, admin UI
bun run --cwd ui build         # admin UI, output in ui/dist
bun run server/main.ts serve
```

`bun run server/main.ts init` first writes a `silo.toml` of default settings if
you would rather configure silo in a file than with flags; it is optional.

From source the server hosts the admin UI from `./ui/dist` relative to its
working directory, with an SPA fallback; skip the UI build if you only want the
API. A released binary is different — `bun run build` embeds `ui/dist` into the
executable, so an installed `silo` serves the UI wherever it is run from.

`serve` runs in the foreground. Add `--detach` to run it in the background
instead and get `silo status`, `silo logs` and `silo stop` — see
[Running as a service](#running-as-a-service).

### First run

```
================================================================
 First run — root API key (shown only this once):

   silo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

 Store it safely. Create more keys with: silo keys create
================================================================

silo 0.2.0 listening on :8090 (instance 01J..., driver sqlite, data ./silo_data)
```

Open <http://localhost:8090>, add the server with its URL and that key, and you
can create a collection, fill in a generated form, add entries, mint more keys,
upload media, and export, import, or copy another instance without touching
curl.

Locked out? Keys live in the data directory, so you can always mint a new one
against it directly, with no running server:

```sh
bun run server/main.ts keys create --preset root --label recovery
```

## Concepts

| Term | What it is |
|------|------------|
| **Instance** | One data directory, one `instance_id`. Everything below lives inside it. |
| **Project** | A named container, for example a tenant or an application. |
| **Environment** | A named container inside a project, for example `prod` or `staging`. |
| **Collection** | A name plus a JSON Schema document, identified by `(project, environment, name)`. |
| **Entry** | A JSON document wrapped in a silo-owned envelope: ULID `id`, `rev`, `seq`, and UTC timestamps. |

Projects and environments are plain string containers with no metadata of their
own. Their ids use the same grammar as collection names: a lowercase letter
first, then `[a-z0-9_-]`, up to 64 characters. One exists when it was created
explicitly *or* while it still holds a schema or an entry, so an empty project
you just created survives an export and a scope you emptied stops being listed.

Names beginning with `_` are reserved for silo. API keys live in the reserved
`_system/_system` scope as a `_keys` collection, stored exactly like user data,
which is why every storage driver and the export engine support them with no
special-case code.

Entries are documents, never a schema-to-table mapping. Schemas are validated on
write only: changing a schema never rewrites or blocks existing entries, and
entries that predate a change are flagged in the UI when opened.

## Admin UI

The admin UI is a React and Vite single-page app in [`ui/`](ui), built to
`ui/dist` and served by the silo server at `/`. It manages a list of servers in
`localStorage` and can connect to any reachable silo instance, so one build can
administer several servers.

It provides a server, project, and environment browser, an entries table per
collection, RJSF-generated entry forms with a raw JSON fallback for constructs a
form cannot render, a schema editor, a media library, key management, and a data
transfer view for export, import, and direct server copy. Navigation and actions
adapt to the claims of the key in use.

See [ui/README.md](ui/README.md) for its architecture and development workflow.

## Configuration

Configuration layers, highest priority first: **flags**, then `SILO_*`
environment variables, then the TOML file, then defaults. Every key is optional.

`silo init` writes the file below — every setting at its default, with the
alternatives and the s3 keys commented beside them. It touches no data
directory, so it is safe to run before anything else.

```toml
# silo.toml
listen          = ":8090"
default_project = "default"   # created on startup if missing
default_env     = "prod"

[storage]
driver = "sqlite"       # "sqlite" | "fs"
path   = "./silo_data"  # data dir; the sqlite file lives at <path>/silo.db

[blob_storage]
driver = "fs"                 # "fs" | "s3"
# path = "/srv/silo-media"    # fs driver; unset means <data dir>/media, and --data moves it
# bucket           = "my-silo-media"   # required by the s3 driver
# region           = "ap-south-1"
# endpoint         = "https://..."     # for S3-compatible providers
# access_key_id    = "..."
# secret_access_key = "..."
# force_path_style = false

[auth]
disabled = false        # dev only: if true, every request is treated as root

[schema]
allow_remote_refs = false  # opt in to fetching http(s) $refs during validation

[log]
level       = "info"          # "debug" | "info" | "warn" | "error" | "silent"
format      = "text"          # "text" (human) | "json" (one object per line)
requests    = true            # a line per HTTP request
max_size_mb = 10              # rotate past this size; 0 never rotates
max_files   = 5               # kept as silo.log.1 … silo.log.5
# file = "/var/log/silo.log"  # unset means the console
```

| Environment variable | Overrides |
|----------------------|-----------|
| `SILO_LISTEN` | `listen` |
| `SILO_DEFAULT_PROJECT`, `SILO_DEFAULT_ENV` | `default_project`, `default_env` |
| `SILO_STORAGE_DRIVER`, `SILO_STORAGE_PATH` | `[storage]` |
| `SILO_BLOB_DRIVER`, `SILO_BLOB_PATH` | `[blob_storage]` |
| `SILO_BLOB_S3_BUCKET`, `SILO_BLOB_S3_REGION`, `SILO_BLOB_S3_ENDPOINT` | `[blob_storage]` |
| `SILO_BLOB_S3_ACCESS_KEY_ID`, `SILO_BLOB_S3_SECRET_ACCESS_KEY` | `[blob_storage]` |
| `SILO_BLOB_S3_FORCE_PATH_STYLE` | `[blob_storage]` |
| `SILO_AUTH_DISABLED` | `[auth] disabled` |
| `SILO_SCHEMA_ALLOW_REMOTE_REFS` | `[schema] allow_remote_refs` |
| `SILO_LOG_LEVEL`, `SILO_LOG_FILE`, `SILO_LOG_FORMAT` | `[log]` |
| `SILO_LOG_REQUESTS`, `SILO_LOG_MAX_SIZE_MB`, `SILO_LOG_MAX_FILES` | `[log]` |

Media follows the data directory: with the `fs` blob driver, `--data <dir>`
stores uploads in `<dir>/media`, so one instance stays in one place. Naming the
directory yourself — `[blob_storage] path`, `SILO_BLOB_PATH` or `--blob-path` —
takes precedence and `--data` leaves it alone.

Invalid default project or environment ids fail at startup rather than creating
a scope that no route can address.

**Where the log goes.** With no `[log] file`, silo logs to the console — always,
whether or not a terminal is attached, so `silo serve > out.txt` and a container
that expects a stream both work. Name a file and silo writes there instead, plus
the console when stdout is a terminal, so a foreground server you are watching
still shows itself. `file` is deliberately left unset by default: the console is
what a supervisor wants, and a value here is indistinguishable from one you
chose. Only `--detach` picks a path for you, `<data dir>/silo.log`.

Only the running server logs. Every other subcommand writes its output to
stdout, because that output is data you might pipe somewhere — sending it to a
log file would take the answer away from you.

### Schema references

A schema can reference other schemas with standard JSON Schema `$ref`:

- `silo://collections/<name>` points at another collection in the same project
  and environment. Always allowed, resolved locally, no network involved. The
  schema builder offers these as **Reference** fields, and entry forms render
  the referenced collection's fields inline.
- `https://...` remote refs are **rejected by default**. Fetching schemas over
  the network during validation makes writes non-deterministic, adds an
  availability dependency, and lets anyone who can edit a schema make your
  server fetch arbitrary URLs. Set `allow_remote_refs = true` to opt in; fetched
  schemas are cached in memory until a schema changes.

Saving a schema bundles its references into `$defs` while preserving the
original reference URL, so the stored document is self-contained. Deleting a
collection that another schema references fails with `409` unless forced.

## Running as a service

`silo serve` runs in the foreground and logs to your terminal. That is the right
shape under Docker, systemd, or any other supervisor — let it own the process,
its restarts, and its output stream. On bare metal or in development, `--detach`
runs the same server in the background:

```sh
silo serve --detach --data /srv/silo
```

The log goes to `<data dir>/silo.log` unless `[log] file` names somewhere else,
and the child's own stdout and stderr are redirected into it too — so a crash
that never reaches the logger still leaves a trace.

```sh
silo status              # pid, address, driver, log path, uptime, health
silo logs --follow       # tail the log; -n sets how many lines to start with
silo stop                # SIGTERM, then SIGKILL after --timeout (default 10s)
```

`silo serve --detach` does not report success until the child has recorded
itself and answered `/api/health`. If it dies on the way up — a port already
taken, an unreadable data directory — you get a non-zero exit and the end of its
log, rather than a pid that quietly no longer exists.

`silo status` exits non-zero when nothing is running, so a shell can branch on
it. It reports the process and the HTTP endpoint separately: a server that is
alive but not answering is a different problem from one that is gone.

### Running more than one instance

Several silos on one machine are fine. Give each its own data directory and its
own port:

```sh
silo serve --detach --data /srv/silo-a --listen :8090
silo serve --detach --data /srv/silo-b --listen :8091
```

They share nothing — separate databases, media, keys, and `instance_id`. Manage
each with `--data`, the same flag you started it with.

**What is not supported is two processes over one data directory.** silo refuses
it, and the refusal is not caution:

- The filesystem driver keeps `last_seq` in memory, so two processes hand out
  the same `seq` values. `seq` is the instance-wide write cursor that
  replication will be built on; duplicates in it are not repairable.
- Writes are serialised on a lock inside one process, which is what makes
  `If-Match` optimistic concurrency sound. A second process makes lost updates
  possible again.
- Compiled schema validators are cached per process, so one server would not see
  the other's schema changes.

A running server records itself in `<data dir>/silo.run.json`, and any `serve`
that finds a live one refuses to start. A server that was killed leaves that
record behind; silo checks whether the process still exists rather than trusting
the file, so a crash never locks your data directory out of use.

Scaling silo horizontally would mean moving `seq` allocation and write
serialisation into the storage layer — a real design change, not a
configuration flag. It is not on the roadmap.

## CLI

Every subcommand operates directly on the data directory, with no running server
required. This is also the lockout recovery path. `stop`, `status` and `logs`
are the exception in the other direction: they read the run file and never open
storage at all, so asking whether a server is running cannot create a data
directory or disturb one another process already owns.

```
bun run server/main.ts init [flags]                  write a silo.toml of default settings
bun run server/main.ts serve [flags]                 start the HTTP server
bun run server/main.ts stop [flags]                  stop a server started with --detach
bun run server/main.ts status [flags]                report whether a server is running
bun run server/main.ts logs [flags]                  show the server log
bun run server/main.ts keys create [flags]           mint an API key (secret shown once)
bun run server/main.ts keys list                     list keys (label, claims, prefix, created)
bun run server/main.ts keys revoke <id>              revoke a key
bun run server/main.ts export [flags]                export schemas, entries, and media
bun run server/main.ts import [flags] <dir|tarball>  import an export
bun run server/main.ts media reconcile               repair the media catalog against stored blobs
bun run server/main.ts version                       print the version
```

| Flags | Applies to | Meaning |
|-------|-----------|---------|
| `--config <path>` | all | TOML config file (default `silo.toml` if present); for `init`, the file to write |
| `--force` | `init` | overwrite an existing config file |
| `--data <dir>` | all | data directory (default `./silo_data`) |
| `--blob-path <dir>` | all | media directory for the fs blob driver (default `<data dir>/media`) |
| `--driver <sqlite\|fs>` | all | storage driver |
| `--listen <addr>` | `serve` | listen address (default `:8090`) |
| `--project <id>`, `--env <id>` | `serve` | defaults created on startup (`default`, `prod`) |
| `-d`, `--detach` | `serve` | run in the background and return |
| `--log-file <path>` | `serve` | write the log here (detached runs default to `<data dir>/silo.log`) |
| `--log-level <s>` | `serve` | `debug`, `info`, `warn`, `error`, or `silent` |
| `--timeout <s>` | `stop` | seconds to wait after SIGTERM before killing (default 10) |
| `-n`, `--lines <n>` | `logs` | how many lines to show (default 50) |
| `-f`, `--follow` | `logs` | keep printing as the log grows |
| `--label <s>` | `keys create` | human-readable label |
| `--claims <a,b>` | `keys create` | explicit comma-separated claims |
| `--preset <root\|write\|read>` | `keys create` | claim preset, ignored when `--claims` is given |
| `--collections <a,b>` | `keys create` | collections the preset targets, empty means all |
| `--project <id>`, `--env <id>` | `keys create` | scope the preset targets (default `*`, all) |
| `--dir <path>`, `--out <path>` | `export` | write a directory tree, or a `.tar.gz` |
| `--with-keys` | `export` | include API key hashes |
| `--mode <merge\|replace>` | `import` | conflict strategy (default `merge`) |
| `--validate` | `import` | validate entries against their schema |
| `--dry-run` | `import` | report what would be written, write nothing |
| `--prefer <local\|remote>` | `import` | override merge conflict resolution |

A bare collection name in `--collections` grants the permission in **every**
project and environment (`collections:*/*/<name>:...`). Write
`project/env/collection` to pin it to one scope.

## HTTP API

JSON everywhere, clean routes under `/api`, no URL versioning: breaking changes
are release-note events, and the data format is versioned separately. CORS is
enabled for `/api/*`.

Present a key as `Authorization: Bearer <key>` or `X-Api-Key: <key>`.

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/health` | liveness and version, never authenticated |
| `GET` | `/api/session` | current key label, prefix, and effective claims |
| `GET` / `POST` | `/api/projects` | list projects visible to the key / create `{id}` |
| `DELETE` | `/api/projects/{project}` | delete a project, its environments and their collections (`?force=true`) |
| `GET` / `POST` | `/api/projects/{project}/envs` | list environments / create `{id}` |
| `DELETE` | `/api/projects/{project}/envs/{env}` | delete an environment and its collections (`?force=true`) |
| `POST` | `/api/projects/{project}/envs/{env}/copy` | copy another environment of this instance into it |
| `GET` / `POST` | `/api/projects/{project}/envs/{env}/collections` | list / create `{name, schema}` |
| `GET` / `PUT` / `DELETE` | `/api/projects/{project}/envs/{env}/collections/{name}/schema` | fetch / update / delete a schema |
| `GET` / `POST` | `/api/projects/{project}/envs/{env}/collections/{name}` | list entries (filter, sort, paginate) / create |
| `GET` / `PUT` / `DELETE` | `/api/projects/{project}/envs/{env}/collections/{name}/{id}` | read / full replace / delete |
| `GET` | `/api/export` | stream a `tar.gz` archive |
| `POST` | `/api/import?mode=` | accept a `tar.gz` archive |
| `POST` | `/api/copy` | pull and import another running silo |
| `GET` / `POST` | `/api/keys` | list keys / create one, the secret is returned exactly once |
| `DELETE` | `/api/keys/{id}` | revoke a key |
| `GET` / `POST` | `/api/media` | list / upload media |
| `DELETE` | `/api/media/{filename}` | delete a media file |
| `GET` | `/media/{filename}` | public asset streaming, immutable cache headers |

`/environments` is accepted anywhere `/envs` appears. Collection, entry, and
environment-copy routes are scoped to a `(project, environment)` pair;
everything else is instance-wide.

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

**List queries.** `?filter=<url-encoded JSON>&sort=-$updated_at,title&limit=50&offset=0`.
Envelope fields carry a `$` prefix (`$id`, `$created_at`, `$updated_at`). The
filter is a small AST rather than a string language:

```json
{"op": "and", "args": [
  {"op": "eq", "field": "status", "value": "published"},
  {"op": "contains", "field": "author.name", "value": "ada"}
]}
```

Leaf operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, and `contains`;
`and` and `or` take `args`. The default limit is 50 and the maximum is 500. The
response is `{"data": [...], "total": n, "limit": ..., "offset": ...}`.

**Optimistic concurrency.** `PUT` and `DELETE` on an entry require the revision
you expect, as `If-Match: "3"` or `?rev=3`. Every entry response carries its
current `rev`, so send back the one you read. A mismatch returns `409`, which is
what stops two admin tabs from silently overwriting each other.

**Errors.** `{"error": {"code": "...", "message": "...", "details": [...]}}` with
codes `validation_failed` (400), `unauthorized` (401), `forbidden` (403),
`not_found` (404), `conflict` (409), and `internal` (500). Validation details
carry JSON Pointer paths from the validator.

## Authentication and claims

silo has no users and no browser sessions. A presented key authenticates the
request, and its claims authorize each individual operation. Claims are deny by
default: an operation whose claim is missing is refused.

Keys are `silo_` followed by 32 random bytes, base64url encoded. Only the
SHA-256 hash is stored, so the plaintext secret exists exactly once, in the
response that created it. Revoking a key deletes its record.

```text
*
collections:<project>/<env>/<name>:create
collections:<project>/<env>/<name>:delete
collections:<project>/<env>/<name>:schema:read
collections:<project>/<env>/<name>:schema:update
collections:<project>/<env>/<name>:access:update
collections:<project>/<env>/<name>:entries:create
collections:<project>/<env>/<name>:entries:read
collections:<project>/<env>/<name>:entries:update
collections:<project>/<env>/<name>:entries:delete
media:read        media:create      media:delete
keys:read         keys:create       keys:revoke
keys:export       keys:import
transfer:export   transfer:import   transfer:copy
```

`*` is the root claim and grants everything.

**Wildcards.** Each of `project`, `env`, and `name` independently accepts `*`.
`collections:acme/*/*:entries:read` covers every environment of one project,
`collections:*/prod/*:entries:read` covers production everywhere, and
`collections:*/*/posts:entries:read` covers one collection wherever it lives.
Action wildcards such as `entries:*` are not valid.

**Delegation does not escalate.** A key holding `keys:create` can mint only keys
whose claims its own already cover. A wildcard segment can delegate matching
named segments; a named segment can never widen into a wildcard.

**Public reads.** Collection schema and entry reads are public by default within
their scope. Set `"x-silo-auth": true` in a schema to require a key for both.
Once a key is presented it becomes the visibility boundary, so a scoped key sees
only its own projects, environments, and collections, even public ones.

**Transfer claims need instance-wide authority.** An archive spans every project
and environment at once, so a `transfer:*` claim is necessary but not
sufficient. Export additionally requires `collections:*/*/*:schema:read` and
`collections:*/*/*:entries:read`; import and copy additionally require
`collections:*/*/*:entries:create`, `:entries:update`, and `:entries:delete`.
Without that rule, `transfer:export` would let a key confined to one project
read every other one.

Copying between two environments of one instance is the exception, and needs no
`transfer:*` claim at all — it reaches nothing the ordinary collection and entry
routes do not, so it asks for those permissions at the two scopes involved
instead. See [Copying between environments](#copying-between-environments).

Presets (`root`, `write`, `read`) are conveniences over the same claim set, in
the CLI through `--preset` and in the admin UI's key form. Stored keys must
carry a `claims` array; legacy role or collection-allowlist records are rejected
rather than translated.

## Portability

```sh
bun run server/main.ts export --dir ./backup               # on-disk tree
bun run server/main.ts export --out backup.tar.gz          # reproducible tarball
bun run server/main.ts import ./backup --mode merge        # newest updated_at wins
bun run server/main.ts import backup.tar.gz --mode replace # replace per collection
```

An export contains every project and environment, including empty ones, plus
schemas, entries, and media. API key hashes are excluded unless you pass
`--with-keys`, so a content export handed to someone never ships credentials.
Entries are ordered by collection and id, so an archive is byte-for-byte
reproducible given identical data.

### On-disk layout

The filesystem driver's layout **is** the export format, which is what makes an
fs-backed instance a live export:

```
<data-dir>/
  manifest.json                 # format_version, instance_id, last_seq
  projects/
    acme/
      prod/
        schemas/
          posts.schema.json
        content/
          posts/
            01J8XQ4Z8K9M2P3R5T7V9X1B3D.json
  media/
```

Each entry file is the full envelope, pretty-printed with a stable field order
so diffs stay small. The same collection name in two environments never collides
on disk or in an archive. SQLite stores the same model in `schemas` and
`entries` tables keyed by `(project, env, collection)`.

### Import modes

- **merge** (default) matches on `(project, environment, collection, id)`.
  Missing locally means insert; present on both sides means newest `updated_at`
  wins, with higher `rev` and then the source `instance_id` as deterministic
  tiebreakers. `--prefer local|remote` overrides this.
- **replace** deletes each collection the archive carries, in that scope only,
  then loads it. Collections absent from the archive are untouched.

Imported entries keep their id, revision, timestamps, and scope. `seq` is
reassigned locally, and the importing instance keeps its own `instance_id`:
cloning data does not clone identity. Validation is off by default, because the
source instance already accepted this data, possibly under an older schema.

Two limits worth knowing. **Deletions do not merge:** v1 has no tombstones, so
only `replace` reflects a deletion made elsewhere. **Imports are not atomic:** a
failure partway leaves earlier writes in place, so treat a failed import as
unknown state and vet untrusted archives with `--dry-run` first.

### Cross-driver migration

Export and import speak only the storage interface, so switching drivers is
`export` on the old instance and `import --mode replace` on the new one. This
doubles as the acceptance test for any new storage driver.

### Direct server copy

The admin UI's **Data transfer** view, and `POST /api/copy`, pull an export from
another running silo and feed it to the same importer. Supply the source URL and
a source key holding `transfer:export`, choose merge or replace, and preview with
a dry run before applying. Source credentials are used for that one outbound
request and are never stored by the destination.

**Data only** preserves the destination's own keys. **Data plus API keys** copies
key hashes as well, which additionally requires `keys:export` on the source and
`keys:import` on the destination; in replace mode the copied keys replace the
destination's, so the source key becomes the destination credential.

```sh
curl -X POST http://new-silo:8090/api/copy \
  -H "Authorization: Bearer $DESTINATION_SILO_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source_url": "http://old-silo:8090",
    "source_api_key": "'"$SOURCE_SILO_KEY"'",
    "mode": "merge",
    "with_keys": false,
    "dry_run": true
  }'
```

### Copying between environments

Moving data between two environments of one instance — promoting `dev` to
`staging`, seeding a fresh environment from `prod` — does not need an archive.
`POST /api/projects/{project}/envs/{env}/copy` is destination-driven like
`/api/copy`: the route names the environment being written and the body names the
source. It takes the same `mode`, `prefer`, `validate` and `dry_run` options an
import does, and runs entirely inside the server.

```sh
curl -X POST http://localhost:8090/api/projects/acme/envs/staging/copy   -H "Authorization: Bearer $SILO_KEY"   -H "Content-Type: application/json"   -d '{"from": {"project": "acme", "env": "prod"}, "mode": "merge", "dry_run": true}'
```

```json
{ "mode": "merge", "dry_run": true, "added": 12, "updated": 0, "deleted": 0, "skipped": 3 }
```

Unlike the archive routes, this needs **no `transfer:*` claim** — it reaches
nothing you could not already reach through the ordinary collection and entry
routes, so it asks for exactly those permissions instead:

```
source        collections:<from-project>/<from-env>/*:schema:read
              collections:<from-project>/<from-env>/*:entries:read
destination   collections:<project>/<env>/*:create
              collections:<project>/<env>/*:schema:update
              collections:<project>/<env>/*:entries:create
              collections:<project>/<env>/*:entries:update
replace mode  collections:<project>/<env>/*:delete
              collections:<project>/<env>/*:entries:delete
```

A key scoped to one project (`collections:acme/*/*:…`) can therefore move data
between that project's environments and no others. Copying an environment onto
itself is a `400`. Media is stored per instance rather than per environment, so
it is shared already and none is copied.

The admin UI exposes this at **Settings → Environment → Data Transfer**, with the
same preview-then-apply flow.

### Format version

Every copy of your data, the SQLite `meta` table, an fs instance's
`manifest.json`, and every export manifest, is stamped with a `format_version`
(currently `"2"`, the project and environment scoped layout). silo refuses to
open or import anything stamped with a version it does not understand, rather
than corrupting or misreading it. The version is bumped for any breaking layout
change, independently of the binary and API version. Pre-1.0 those bumps ship
without migration tooling: re-export with the previous build and re-import, or
start fresh.

## Deployment

The Docker image runs as the unprivileged `bun` user. Its `/data` volume holds
both the SQLite database and, with the default filesystem media driver, uploads
under `/data/media`. Supply the mount at runtime with `-v`, Compose, or a
platform volume; the Dockerfile intentionally declares no `VOLUME`, which keeps
it compatible with platforms such as Railway. A `HEALTHCHECK` backed by
`GET /api/health` is built in.

Run silo in the **foreground** under Docker, systemd, or any other supervisor —
that is what the image does, and it is what lets the supervisor see the process
exit, restart it, and collect its stream. `--detach` is for bare metal and
development; using it inside a container would exit the entrypoint immediately
and take the container down with it. Leave `[log] file` unset there too, so logs
reach `docker logs` and journald rather than a file inside the container.

With a host bind mount, make the directory writable by the image's `bun` user.
If a volume was created by an older root-running image, migrate its ownership
once:

```sh
docker run --rm --user root --entrypoint chown \
  -v silo_data:/data silo -R bun:bun /data
```

### systemd

Foreground, with systemd owning the process and journald owning the log:

```ini
[Unit]
Description=silo
After=network.target

[Service]
ExecStart=/usr/local/bin/silo serve --data /var/lib/silo --listen :8090
User=silo
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`Type=simple` (the default) is correct here: silo stays in the foreground, so
systemd tracks it directly and needs no pid file. Leave `[log] file` unset and
`journalctl -u silo` has everything. Do not add `--detach` — the unit would
consider the service dead the moment the parent returned.

## Development

```sh
bun test                # server, shared, and storage conformance suites
bun run server/main.ts serve --data ./silo_data
cd ui && bun run dev    # hot-reloading admin UI against a running backend
cd ui && bun run lint   # oxlint plus stylelint
```

`bun run build` compiles the server into a standalone binary — `silo`, or
`silo.exe` on Windows, where Bun adds the extension itself. It runs wherever Bun
does: the ad-hoc `codesign` pass that a Bun-compiled Mach-O needs is applied on
macOS and skipped everywhere else, so nothing in the build is host specific. The
admin UI is built and embedded into the executable, so the result serves it from
any working directory.

The same script builds every release artifact, so one is reproducible locally:

```sh
bun run build -- --target linux-x64 --version 0.2.0 --out dist/linux-x64/silo --archive
```

### Versioning

The root `package.json` is the only place silo's version is written. Everything
derives from it — the binary, the archives, the RPM, the Homebrew formula — and
one command moves the lot:

```sh
bun run set-version 0.2.0
```

It rewrites every workspace manifest and commits nothing. A build that is not a
release reports the version with a `-dev` suffix, so a local `silo version` is
never mistaken for the published artifact of the same number; pushing a `v0.2.0`
tag is what publishes it, and the release refuses a tag that disagrees with the
manifest.

| Path | What it is |
|------|------------|
| `server/` | Bun and Hono backend: `core/` (domain, ports, schema, transfer, service), `adapters/` (storage, blob, http client), `http/` (server, routes, auth, middleware), `cli/`, `config/` |
| `shared/` | `@silo/shared`, a Bun workspace holding runtime-neutral rules both the server and UI depend on: claims, validation errors, schema keywords, key format |
| `ui/` | React and Vite admin UI, built to `ui/dist` |
| `server/test/`, `shared/test/` | `bun test` suites |
| `scripts/` | Build, packaging, and versioning tooling invoked through `bun run`, outside the server's source tree |
| `packaging/` | The Homebrew formula and the dnf package: systemd unit, scriptlets, and repository metadata |

The architecture is ports and adapters: `server/core/` defines domain types and
the `Storage` and `BlobStorage` interfaces and imports no adapter, adapters
implement them, and the CLI wires everything explicitly from config. The testing
spine is the storage conformance suite in
`server/test/conformance/storage-conformance.ts`, run against both drivers, plus
export and import round-trip tests. Both drivers are held to identical behavior
there, which is what keeps migration between them honest.

Two conventions run through the whole repository. Every exported class,
interface, function, and React component gets its own file, and files target 100
to 150 lines, so a directory listing doubles as an index. Logic lives in classes
and static helpers rather than loose top-level functions.

## Roadmap

- **MCP server.** Expose an instance over the Model Context Protocol so agents
  and MCP-aware editors can browse collections, query entries, and write content
  through the same claims a REST key carries, with no bespoke integration per
  tool.
- **Custom adapters.** Storage and blob storage are already interfaces that the
  core never reaches around. The work left is a documented, versioned extension
  surface plus a published conformance suite, so a third-party adapter, for
  example Postgres, a git remote, or another object store, can be dropped in and
  proven to behave exactly like the built-in drivers.
- **More backup options.** Scheduled and incremental exports, retention
  policies, and pushing an archive straight to a remote target such as an
  S3-compatible bucket, a git repository, or another running silo, instead of
  only writing a local directory or tarball.

Further out, and already designed for rather than built: a sync engine using the
`rev` and `seq` metadata every entry already carries, tombstones so deletions
propagate through a merge, key expiry, relation integrity enforcement, and
full-text search behind an optional interface.

## Contributing

Issues and pull requests are welcome at
<https://github.com/org-quicko/silo>.

`bun test` must pass before a change lands, and behavior changes should come
with the test that covers them. Anything touching storage belongs in the
conformance suite, so both drivers are held to one answer.

Open an issue before building something structural: a new port, a change to the
claim grammar, or anything that moves the on-disk layout. That layout is a
frozen public format and only changes with a `format_version` bump, so those
proposals are worth agreeing on before the code exists.

[JSON Schema draft 2020-12]: https://json-schema.org/specification
