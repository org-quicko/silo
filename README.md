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
- [Plugins](#plugins)
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
bun run --cwd apps/admin build   # admin UI, output in apps/admin/dist
bun run apps/server/src/main.ts serve
```

`bun run apps/server/src/main.ts init` first writes a `silo.toml` of default settings if
you would rather configure silo in a file than with flags; it is optional.

From source the server hosts the admin UI from `./apps/admin/dist` relative to its
working directory, with an SPA fallback; skip the UI build if you only want the
API. A released binary is different — `bun run build` embeds `apps/admin/dist` into the
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
bun run apps/server/src/main.ts keys create --preset root --label recovery
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

The admin UI is a React and Vite single-page app in [`apps/admin/`](apps/admin), built to
`apps/admin/dist` and served by the silo server at `/`. It manages a list of servers in
`localStorage` and can connect to any reachable silo instance, so one build can
administer several servers.

It provides a server, project, and environment browser, an entries table per
collection, RJSF-generated entry forms with a raw JSON fallback for constructs a
form cannot render, a schema editor, a media library, key management, plugin
management, and a data transfer view for export, import, and direct server copy.
Navigation and actions adapt to the claims of the key in use.

**Settings → Plugins** is the grant screen: what each plugin asked for, what you
allow, and what it is doing. Approving, narrowing, revoking, pausing, restarting
and reconfiguring all take effect immediately, and each plugin's settings form is
generated from its own manifest schema. Hook delivery leads every grant, because
a plugin handed `entry.beforeValidate` can rewrite everything written to a
collection — a larger authority than any `entries:*` permission, and one that
reads like a smaller one.

Search is on the table and on `⌘K`: the table searches its own collection and
shows which field each result matched, while `⌘K` searches every collection the
key can read, across projects and environments, with media as its own group. A
filter builder writes the same query AST the API takes. All of it lives in the
URL, so a searched, filtered, sorted view is a link you can send someone.

See [apps/admin/README.md](apps/admin/README.md) for its architecture and development workflow.

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

[search]
enabled             = true          # false keeps no index; search falls back to a full scan
tokenizer           = "unicode61"   # "unicode61" (words) | "trigram" (substrings; required for CJK)
max_entry_bytes     = 65536         # per-entry cap on indexed text
scan_limit          = 20000         # entries one un-indexed scan may visit before truncating
scan_time_budget_ms = 3000          # ...and how long, whichever comes first
# Changing the tokenizer rebuilds the index on the next start.

[log]
level       = "info"          # "debug" | "info" | "warn" | "error" | "silent"
format      = "text"          # "text" (human) | "json" (one object per line)
requests    = true            # a line per HTTP request
max_size_mb = 10              # rotate past this size; 0 never rotates
max_files   = 5               # kept as silo.log.1 … silo.log.5
# file = "/var/log/silo.log"  # unset means the console

# Plugins. An *ordered* array — the order is hook dispatch order. This says
# *which* plugins load; what each may do is a grant in the store, and `claims`
# here is a second, declarative way to say it. Absent by default; `init` writes
# none. See "Plugins" below.
# [[plugins]]
# name   = "silo-plugin-slug"           # a directory under <data dir>/plugins/
# claims = ["collections:*/*/*:entries:read"]
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
| `SILO_SEARCH_ENABLED`, `SILO_SEARCH_TOKENIZER` | `[search]` |
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
bun run apps/server/src/main.ts init [flags]                  write a silo.toml of default settings
bun run apps/server/src/main.ts serve [flags]                 start the HTTP server
bun run apps/server/src/main.ts stop [flags]                  stop a server started with --detach
bun run apps/server/src/main.ts status [flags]                report whether a server is running
bun run apps/server/src/main.ts logs [flags]                  show the server log
bun run apps/server/src/main.ts keys create [flags]           mint an API key (secret shown once)
bun run apps/server/src/main.ts keys list                     list keys (label, claims, prefix, created)
bun run apps/server/src/main.ts keys revoke <id>              revoke a key
bun run apps/server/src/main.ts export [flags]                export schemas, entries, and media
bun run apps/server/src/main.ts import [flags] <dir|tarball>  import an export
bun run apps/server/src/main.ts media reconcile               repair the media catalog against stored blobs
bun run apps/server/src/main.ts search reindex [--check]      rebuild the search index, and verify it
bun run apps/server/src/main.ts add <spec> [flags]            install a plugin and list it in silo.toml
bun run apps/server/src/main.ts plugin list                   configured plugins and what they attach to
bun run apps/server/src/main.ts plugin info <name>            one plugin's manifest, claims and config
bun run apps/server/src/main.ts plugin grant <name>           approve what a plugin asked for
bun run apps/server/src/main.ts plugin revoke <name>          withdraw the stored grant
bun run apps/server/src/main.ts plugin doctor                 load every plugin, report failures, exit
bun run apps/server/src/main.ts version                       print the version
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
| `--check` | `search reindex` | also report both index integrity checks, exiting non-zero on disagreement |
| `--claims <a,b>` | `plugin grant`, `add` | approve exactly these instead of everything the manifest requests |
| `--integrity <sri>` | `add` | check the downloaded bytes against a `sha512-...` digest |
| `--ref <r>`, `--registry <url>` | `add` | git ref to check out; npm registry to fetch from |
| `-y`, `--yes` | `add` | do not ask before granting (a non-interactive shell without it is a no) |
| `--force` | `add` | replace an already-installed plugin of the same name |
| `--no-register` | `add` | install the files, print the block, leave `silo.toml` alone |

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
| `DELETE` | `/api/keys/{id}` | revoke a key, and everything descended from it |
| `GET` | `/api/plugins` | list plugins: what each requested, what it was granted, and what it is doing |
| `GET` | `/api/plugins/{name}` | one plugin, with an `ETag` to send back as `If-Match` |
| `PUT` / `DELETE` | `/api/plugins/{name}/grant` | approve or narrow a grant / withdraw it |
| `POST` | `/api/plugins/{name}/enable`, `/disable` | start or stop a plugin now |
| `PATCH` / `DELETE` | `/api/plugins/{name}/config` | change its config / return it to `silo.toml` |
| `POST` | `/api/plugins/{name}/restart` | bring a dead worker back |
| `POST` | `/api/plugins/rescan` | re-read `silo.toml` and apply it |
| `GET` | `/api/audit` | who changed what authority, and when |
| `GET` / `POST` | `/api/media` | list / upload media |
| `DELETE` | `/api/media/{id}` | delete a media asset, refused while an entry still references it |
| `GET` | `/api/projects/{project}/envs/{env}/collections/{name}/search` | search one collection |
| `GET` | `/api/projects/{project}/envs/{env}/search` | search one environment |
| `GET` | `/api/search` | search everything the key can read |
| `POST` | `/api/search/reindex` | rebuild the search index |
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
hooks:<project>/<env>/<name>:<hook>
media:read        media:create      media:delete
keys:read         keys:create       keys:revoke
keys:export       keys:import
plugins:read      plugins:grant     plugins:enable     plugins:configure
audit:read        http:route
transfer:export   transfer:import   transfer:copy
```

`*` is the root claim and grants everything.

`hooks:...` is **delivery**, and it is deliberately not implied by any
`collections:...:entries:*` permission: being handed an entry before it is
validated, with the chance to rewrite it, is a different authority from reading
a committed one. It exists for plugins — see [Plugins](#plugins) — and the
`<hook>` segment is one of the five hook names, with no wildcard.

`plugins:*` and `audit:read` guard the management API and the authority trail.
There is no `audit:write`: nothing updates or deletes an event, so a claim
guarding that would imply a capability that does not exist.

`http:route` is the other plugin-shaped claim, beside `hooks:...`: it lets a
plugin **be reached** at the routes its manifest declares, and grants no reach of
its own, so a key holding it gains nothing. One claim covers every route a
manifest lists, because they are all mounted under the plugin's own name and it
cannot escape that prefix — what an operator weighs is the route list itself. See
[Serving routes](#serving-routes).

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

## Plugins

A plugin is a directory under `<data dir>/plugins/` that silo loads because
`silo.toml` names it. `silo add` will put one there and list it for you, but it
is not doing anything you could not: place the directory, list it, it runs.
Plugins live in the data directory rather than beside the binary because a
packaged binary is root-owned and read-only, and because an instance is a
directory you can copy — so an instance travels with its extensions.

A package declares what it **contributes**, and it may contribute more than one
thing:

| Contribution | What it does | Runs |
|--------------|--------------|------|
| `hooks` | Reacts to the entry and collection lifecycle | In a `Worker`, one per plugin |
| `routes` | Serves HTTP under `/api/ext/<name>/` | In the same `Worker` |
| `runtime` | Runs `activate(ctx)` at startup and `deactivate(ctx)` on the way out | In the same `Worker` |
| `providers` | Implements the storage or blob-storage port, adding a driver name | In-process, before storage opens |

None of them is exclusive: a storage provider may register the hook that keeps
its own derived data in step, and a plugin that only wants a startup task does
not have to invent a hook to be called. Each provider names its **own entry
module**, because it is imported before storage exists while the rest of the
package runs in a worker afterwards.

The built-in adapters are registered through the same registry, under the
reserved names `sqlite`, `fs` and `s3` that no plugin may take. `[storage]
driver` is a lookup in that registry, so a third-party store is selected exactly
the way a built-in one is.

### Writing one

A plugin needs no build step — silo transpiles TypeScript itself — and **no
dependencies at all**, including on silo.

To start from a working one:

```sh
npm create silo-plugin          # or: bun create silo-plugin
```

[`create-silo-plugin`](packages/create-silo-plugin/) asks what the plugin is for and
writes the manifest, a runnable stub per hook you pick, the `silo:api` type
declarations, and the `[[plugins]]` block to paste into `silo.toml`. Everything
below is what it produces, and what to change once you have it.

`<data dir>/plugins/silo-plugin-slug/package.json`

```json
{
  "name": "silo-plugin-slug",
  "type": "module",
  "main": "index.ts",
  "silo": {
    "silo": "^1",
    "contributes": { "hooks": ["entry.beforeValidate"] },
    "permissions": {
      "required": [
        {
          "claim": "collections:*/*/*:entries:read",
          "reason": "To check the slug is not already taken."
        }
      ]
    },
    "config": {
      "type": "object",
      "properties": { "field": { "type": "string" } },
      "required": ["field"],
      "additionalProperties": false
    }
  }
}
```

The `silo` block is the **manifest**, and it is static on purpose: `silo plugin
info` has to show an operator what a package wants *before* any of its code
runs.

| Key | Meaning |
|-----|---------|
| `silo` | The version range of silo this plugin supports, checked at startup. There is no separate plugin API version — a breaking change to a hook payload is a major version of silo. |
| `contributes.hooks` | Which hooks to dispatch. A hook the module exports but does not declare here is never called. |
| `contributes.routes` | The HTTP routes this plugin serves, each `{ "method", "path", "auth" }`. Served under `/api/ext/<name>/`. Declaring any of them asks for the `http:route` claim automatically. |
| `contributes.runtime` | `true` when the module exports `activate(ctx)` and `deactivate(ctx)`. Declaring it and not exporting them refuses the start. |
| `contributes.providers` | Storage or blob drivers, each `{ "port", "driver", "entry" }`. `entry` is required: a provider is imported before storage exists, so it cannot share the module the worker half runs from. |
| `permissions.required` | What the plugin does not work without. **This is what a default grant approves.** Each entry is `{ "claim", "reason" }`, and the reason is not optional — it is what an operator reads while deciding. |
| `permissions.optional` | Extras. Ungranted is a normal outcome, never an error. |
| `config` | A JSON Schema for `[plugins.config]`, validated at startup. |

A package must contribute *something* — otherwise nothing would ever call it,
and the start refuses saying so. A `hooks:` claim per declared hook, and
`http:route` for declared routes, are added to the request for you; writing them
out again would be two lists to keep in step.

`<data dir>/plugins/silo-plugin-slug/index.ts`

```ts
import { defineSiloPlugin, ValidationError } from "silo:api";

export default defineSiloPlugin({
  "entry.beforeValidate"(event, ctx) {
    if (event.collection !== "posts") return;

    const title = event.data[ctx.config.field];
    if (typeof title !== "string") throw new ValidationError("a post needs a title");

    return { data: { ...event.data, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-") } };
  },
});
```

`silo:api` is a **virtual module**. It has no file on disk and is not on npm --
silo injects it into the plugin's import graph before the plugin loads. That is
why a plugin declares no dependencies, and why there is only ever one copy of
`ValidationError` in play instead of one per plugin. For editor support, keep
`apps/server/src/plugins/host/silo-api-types.d.ts` next to your plugin; it is types only
and contributes nothing at runtime. `create-silo-plugin` copies it for you, and
a test in this repo keeps the two byte-identical.

### Enabling one

Two separate decisions, kept apart on purpose.

**Which plugins load, and in what order** is `silo.toml` — the operator's file,
and nothing but a text editor writes it:

```toml
[[plugins]]
name       = "silo-plugin-slug"   # the directory under <data dir>/plugins/
claims     = []                   # a declarative grant; see below
timeout_ms = 5000                 # per dispatch
on_error   = "fail"               # "fail" (default) | "skip"

  [plugins.config]
  field = "title"
```

The array is **ordered, and that order is hook dispatch order** — top to
bottom, with no priority number to compete over and no load-order surprise.

`name` resolves under `<data dir>/plugins/` as either a plain directory or a
`node_modules/<name>` layout. There is deliberately no `SILO_PLUGINS`
environment variable: which code an instance runs is not something the
environment should be able to change.

**What each plugin is allowed to do** is a record in the reserved `_plugins`
collection, changed through `silo plugin grant` or the management API. The split
is the load-bearing part: *if grants lived in config, revoking would need a
restart; if registration lived in the database, whoever could write the database
could execute code.*

A listed plugin that nobody has approved is **`pending`**. It loads, it is
delivered nothing, and every `ctx` call is refused — a state, not a failure, and
the one exception to "a plugin that cannot do its job refuses the start":
approving needs a running server to approve through, so a server that refused to
boot could never be given one. It is loud about it, on every start, in
`silo plugin list`, and in a non-zero exit from `silo plugin doctor`.

```sh
silo plugin grant silo-plugin-slug                  # approve what it says it requires
silo plugin grant silo-plugin-slug --claims a,b     # approve exactly these
silo plugin revoke silo-plugin-slug                 # withdraw the stored grant
```

**The default is `required`, not everything asked for.** A package that declares
nothing optional sees no difference; one that does gets to offer an extra without
having it approved by default, which is the only reading under which "optional"
means anything. `silo plugin info` prints both lists with the author's reason
beside each claim, and the admin UI shows the same thing beside a checkbox. A
grant short of a required claim is a warning rather than a refusal — narrowing on
purpose is a legitimate thing to do — but it is a warning you will see, on the
start and on the change.

Both are offline, against the data directory — the same authority
`silo keys create` already has there — which is what makes them the way out of
that boot deadlock, and the way to provision a plugin in CI.

Effective authority is the **union** of the two paths, each bounded by what the
manifest requested. Two paths because they serve genuinely different
deployments: a container built from a config map cannot use an interactive
grant, and an operator on a box does not want to hand-edit TOML to withdraw one.
`silo plugin revoke` clears only the stored half, and says so when `silo.toml`
still grants something.

Approving mints a real API key for the plugin, with exactly the granted claims
and `owner: {kind: "plugin"}`. Its secret stays host-side and the plugin never
sees it — not because a hostile plugin would gain anything by holding one, but
because the common failure is accidental: a plugin logging its token, or sending
it to a telemetry endpoint. `silo keys revoke` refuses a managed key and names
`silo plugin revoke` instead; a managed key never counts toward bootstrapping,
and is left out of every archive.

### Managing a running instance

Everything under `/api/plugins/` acts on the grant record and the running set,
and **takes effect immediately** — there is no restart in any of these answers:

```sh
curl -X PUT http://localhost:8090/api/plugins/silo-plugin-slug/grant \
  -H "Authorization: Bearer $SILO_KEY" -H 'If-Match: "3"' \
  -H "Content-Type: application/json" \
  -d '{"claims": ["collections:blog/prod/posts:entries:read"]}'
```

| Call | Claim | Does |
|------|-------|------|
| `GET /api/plugins`, `/api/plugins/{name}` | `plugins:read` | what each requested, what it was granted, and what it is doing |
| `PUT`/`DELETE /api/plugins/{name}/grant` | `plugins:grant` | approve or narrow / withdraw. Live on the next hook and the next `ctx` call |
| `POST /api/plugins/{name}/enable`, `/disable` | `plugins:enable` | start or stop the plugin now |
| `PATCH`/`DELETE /api/plugins/{name}/config` | `plugins:configure` | change its config / return it to `silo.toml` |
| `POST /api/plugins/{name}/restart` | `plugins:enable` | bring a worker back after it died |
| `POST /api/plugins/rescan` | `plugins:enable` | re-read `silo.toml` and apply it |

**`If-Match` is required on everything that writes the record**, and on a grant
it is not ceremony: approving means approving *what you read*. Without the
fence, a package whose request changed between the read and the approval would
be approved on the strength of the older one. `restart` and `rescan` write no
record, so neither takes one.

**The API never writes `silo.toml`.** One that could add a `[[plugins]]` block
would be a code-execution primitive wearing a management claim. `rescan` reads
that file — the one the operator already wrote — and applies it: plugins added,
removed, reordered, upgraded in place, or reconfigured. It is also how a grant
made with the offline CLI reaches a server that is already running.

`enabled` is orthogonal to the grant. A disabled plugin keeps its claims and its
key, because pausing something is not the same decision as un-approving it — and
an operator who had to re-approve after every pause would learn to approve
widely to avoid the trouble.

`PATCH .../config` takes an [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)
merge patch, so one setting changes without restating the block and `null`
removes one. The result **replaces** `silo.toml`'s block for that plugin rather
than merging with it — two config documents have no sane join, and "what config
is this plugin running with" should be something you read, not something you
compute. `DELETE .../config` is the way back, and `config_source` on every view
says which of the two is in force.

Every view carries a `runtime` block — `running`, `stopped` or `failed`, with a
sentence saying why when it is not running. That is a different question from
`enabled` and `state`, which are what an operator *decided*: a granted, enabled
plugin whose worker outlived its dispatch budget is torn down and not respawned,
and `POST .../restart` is the deliberate way back. A restart is never automatic —
a plugin that missed its budget is usually still spinning, so a respawn would
walk into the same wall while hiding that anything happened.

**All of it is in the admin UI** under *Settings → Plugins*, which is the same
API with sentences around it: what a plugin asked for beside what you allow, the
claims narrowed to a project and environment with two selects, a settings form
generated from the plugin's own manifest schema, and the trail below. It leads
with hook delivery and flags a hook that can change or stop a write, because
`entry.beforeValidate` over a collection is a larger authority than
`entries:update` and reads like a smaller one.

**Who changed what** is `GET /api/audit`, behind `audit:read`. It records
authority decisions only — `key.create`, `key.revoke`, `plugin.grant`,
`plugin.revoke`, `plugin.enable`, `plugin.disable`, `plugin.configure` — and
never entry writes, which is what `rev`, `updated_at` and the hook stream
already are. The **services** append rather than the routes, so a change made
with the offline CLI is in it too. Retention is unbounded on purpose: an
authority log grows with decisions, not with traffic.

### Hooks

Six. The five entry hooks each carry `op`, so `create` and `update` share one
function:

| Hook | May | Notes |
|------|-----|-------|
| `entry.beforeValidate` | replace `data`, reject | The only mutating hook |
| `entry.beforeWrite` | reject | The data is already validated |
| `entry.afterWrite` | observe | Best-effort, at-most-once |
| `entry.beforeDelete` | reject | Carries the entry, not just its id |
| `entry.afterDelete` | observe | Best-effort, at-most-once |
| `collection.afterDelete` | observe | One event per collection erased, however many entries went |

`collection.afterDelete` is the only way to hear about a **forced** delete.
`DELETE .../collections/{name}?force=true`, and the environment and project
equivalents, erase every entry underneath without dispatching
`entry.afterDelete` for each of them — one event per row would make a 100k-row
delete a 100k-event fan-out for a fact that is one sentence long. So the event
carries the collection, `erased`, and a `cause` of `collection`, `environment` or
`project`; the last two mean every sibling collection is going too, so the useful
reaction is to drop the scope rather than one table. There is no `before`
counterpart: a veto there would overrule an explicit `force` from a caller who
already had to hold `entries:delete` at that reach.

Mutation happens **before** validation, so the schema judges exactly what gets
stored. After validation a hook may reject but not rewrite — otherwise it would
store a value the schema never saw.

Plugins shape `data`. The envelope — `id`, `rev`, `seq`, timestamps — belongs
to silo, and no hook can set it.

**Hooks are lifecycle events, not HTTP middleware.** They fire for the CRUD API
and for a plugin's own writes. They deliberately do *not* fire for `silo import`
or a scope copy: an import reproduces an archive faithfully, and a hook
rewriting data mid-import would make export then import non-idempotent — which
is the single property [Portability](#portability) rests on.

**Delivery is claim-checked**, before the event crosses into the worker — see
below.

### Serving routes

A plugin can answer HTTP itself. Declare the routes in the manifest, implement
each as a function named the same way, and silo serves them under
`/api/ext/<name>/`:

```json
"silo": {
  "contributes": {
    "routes": [
      { "method": "GET",  "path": "/health", "auth": "public" },
      { "method": "POST", "path": "/reindex/:collection" }
    ]
  },
  "permissions": {
    "required": [
      {
        "claim": "collections:*/*/*:entries:read",
        "reason": "To count what a reindex would queue."
      }
    ]
  }
}
```

Declaring routes asks for `http:route` on the plugin's behalf — there is no need
to list it.

```ts
export default defineSiloPlugin({
  "GET /health"() {
    return { ok: true };
  },

  async "POST /reindex/:collection"(request, ctx) {
    if (!request.caller.claims.includes("*")) {
      throw new ForbiddenError("this one is for admins");
    }
    const page = await ctx.entries.list(
      { project: "blog", env: "prod" },
      request.params.collection,
    );
    return { status: 202, json: { queued: page.total } };
  },
});
```

A handler takes `(request, ctx)` and returns a value, never a status code:
nothing is a `204`, a string is `text/plain`, any other object is a JSON body,
and `{ status, headers, body }` or `{ json }` sets one explicitly. Throwing
`ValidationError` or `ForbiddenError` answers `400` or `403`, exactly as it does
from a hook.

`request` carries the method, the declared `path`, the bound `params`, the
`query`, the `headers`, the `body` as text, and `caller`. **`caller` is who is
calling, never how they proved it** — an id, a label and their claims, with
`Authorization`, `X-Api-Key` and `Cookie` withheld. It is `null` on a `public`
route reached with no credential.

Two things are worth being deliberate about.

**A route runs with the plugin's authority, not the caller's.** That is what a
plugin route is for — a handler bounded by the caller's claims could only do what
the caller could have done directly — but it means **reaching a route is reaching
the plugin's grant**. Serving routes at all therefore costs the `http:route`
claim, which declaring one adds to the request for you, and `auth: "public"` is a separate line on the grant screen, because a
public route publishes whatever the plugin was granted to anyone who can reach
the URL. Check `request.caller.claims` when a route should be narrower than the
plugin is.

**silo matches the routes; a plugin never registers one.** The grammar is literal
segments and `:name` parameters — no wildcards, no regular expressions — and a
path that could reach outside the namespace is refused at startup, naming the
package. The upshot is that a plugin cannot shadow or reorder a built-in route,
and that its routes come and go with `enable`, `disable`, `grant`, `revoke` and
`rescan` without a restart, like its hooks.

`HEAD` reaches a declared `GET`. A handler that misses `timeout_ms` answers `504`
and the plugin is left `failed` until `POST /api/plugins/<name>/restart`. Request
bodies are capped at 1 MiB.

### What a plugin is allowed to do

A plugin never receives the database or the service. It acts through `ctx`, and
a `ctx` call **is a request against silo's own HTTP API** — the same routes, the
same guards, the same answers a key with those claims would get. That is not an
analogy for the claim check; it is the claim check. **A plugin is an API key
with code attached.**

```ts
// The typed client, for what a plugin usually wants:
const page = await ctx.entries.list(event.scope, "posts", { limit: 10 });

// ...and the API underneath it, for everything else. Paths must be under
// /api/; a refusal comes back as a status, not a throw.
const response = await ctx.fetch("/api/media?limit=5");
```

Authority comes from two places and is the **union** of them: the `claims` in
`silo.toml`, and what an operator approved through `PUT
/api/plugins/{name}/grant` or `silo plugin grant`. Neither may exceed what the
manifest requested.

```toml
claims = ["collections:blog/prod/posts:entries:read"]
```

Being *told about* a hook is its own claim, separate from any `entries:*`
permission — being handed a value before it is validated is not reading a
committed one. It is checked **before the event crosses into the worker**,
because a check on the far side would be an audit trail rather than a boundary:

```toml
claims = ["hooks:blog/prod/posts:entry.beforeValidate"]
```

A plugin whose grant delivers a hook it declares in **no** scope at all refuses
the start. A missing API claim is not an error — a plugin may run on less than
it asked for — but a hook that can never fire means the plugin loads, looks
healthy, and never does the thing it was installed for.

A plugin may never be granted `root`, the `plugins:*` claims, or
`keys:create|revoke|import` — it runs code, so any of those would let it widen
its own grant, or make the grant irrelevant. Every other claim uses the grammar
in [Authentication and claims](#authentication-and-claims).

A plugin that declares `contributes.runtime` gets `activate(ctx)` once it is
live, and `deactivate(ctx)` on the way out. `activate` runs before silo takes its
first request, so setup that must succeed belongs there — a throw refuses the
start, naming the plugin. It costs no claim, because nobody but silo calls it and
its `ctx` is the same claim-checked surface a hook's is; what it adds is work
nothing asked for, not reach. `deactivate` is best-effort: the decision to stop
has been taken by the time it runs.

Withdrawing a grant is **live**: the next hook is not delivered and the next
`ctx` call is refused, with no restart and without the plugin being torn down.
Changing what a key may do has never meant restarting whoever holds it, and a
plugin is an API key with code attached.

Throwing `ValidationError` or `ForbiddenError` from a hook is a **deliberate
rejection** and surfaces as a 400 or 403. Any other throw is a **plugin fault**,
governed by `on_error`: `fail` refuses the write, `skip` logs it and carries on.
Either way it is logged. `afterWrite` and `afterDelete` never fail a request --
the write has already committed, and a 500 there would invite a retry that
writes twice.

### The trust boundary

Extension plugins run in a `Worker`. **That bounds faults, not malice.** A
plugin that crashes, spins forever, or eats memory is timed out, torn down and
reported while the server keeps serving, and it is not restarted into the same
wall on the next write. It does *not* stop plugin code reading the database or
opening a socket: worker code holds full privileges.

The trust boundary is the act of installing, exactly as it is for an npm
package, a VS Code extension, or a Strapi plugin. The claim check expresses
intent and catches mistakes; it is not a sandbox. Read a plugin before you place
its directory.

### Installing

```sh
silo add ./my-plugin                     # a directory you have
silo add ./silo-plugin-slug-1.2.0.tgz    # a package file
silo add silo-plugin-slug@^1             # from npm
silo add https://example.com/p.tgz --integrity sha512-...
silo add https://github.com/acme/silo-plugin-slug --ref v1.2.0
```

`silo add` unpacks the package into `<data dir>/plugins/<name>/` and appends a
`[[plugins]]` block to your `silo.toml`. You can still do both by hand — the
directory it writes is the one you would have placed yourself, and nothing
downstream can tell the difference.

It **runs none of the package's code**, and no lifecycle script, ever. The
manifest is validated, the `silo` range is checked against your binary, and a
provider is refused a reserved driver name — all before anything is imported.
Archives are refused if they contain absolute paths, `..`, symlinks, hard links,
device nodes, or setuid/setgid/sticky mode bits, and are checked in full before a
single file is written, so a bad package leaves nothing behind. An ordinary
executable at `0755` is fine — the mode check is about privilege, not the
executable bit.

What can be verified depends on where it came from, and `add` tells you which
you got:

| Source | Checked against |
|--------|-----------------|
| npm | the registry's own `sha512` digest — and `--integrity` too if you pass one, in which case both must agree |
| https URL | `--integrity` if you pass one — otherwise TLS alone, and it says so |
| local `.tgz` | `--integrity` if you pass one; a digest is computed either way, so the *next* install is checked |
| directory | nothing is transferred, so `--integrity` is refused rather than ignored |
| git | nothing — pinned by resolved commit; `--integrity` is refused |

Passing `--integrity` to npm is worth it when you know the digest independently:
the registry supplies both the tarball and the digest it is checked against, so
pinning is what a compromised registry cannot satisfy.

A plugin's claims are shown before they are granted, and you are asked. That
distinction is the point: a manifest *requests* claims, you *grant* them.

```
--claims a,b     grant these instead of what the manifest requests
-y, --yes        do not ask (a non-interactive shell without this is a no)
--force          replace an already-installed plugin of the same name
--no-register    install the files, print the block, leave silo.toml alone
```

`<data dir>/plugins/silo-plugins.lock.json` records what was installed, where it
came from, and what it was verified as. It is a **record, not a resolver**:
`serve` still loads exactly what `silo.toml` names, and deleting the lockfile
breaks nothing.

silo installs no dependencies. A plugin needs none — that is what `silo:api`
buys — and a package that declares some is installed with a warning rather than
a dependency tree. There is no `remove`: `POST /api/plugins/{name}/disable`
stops one on a running server, deleting the `[[plugins]]` block stops it
loading at all, and deleting the directory is how you are rid of it.

A running server picks up an added plugin on `POST /api/plugins/rescan`, or at
its next start — never on its own. Placing a directory under `plugins/` is not
consent to run it, and neither is listing it: the plugin still arrives
`pending` and is granted separately.

### Inspecting

```
silo plugin list             configured plugins, what they attach to, their state and claims
silo plugin info <name>      one plugin's manifest, requested vs granted claims, config
silo plugin doctor           load everything the way serve would, report failures, exit
```

All three are read-only and need no network. `list` and `info` read the manifest
without executing anything, so they still work on a plugin that would fail to
load, and both show the request beside the grant — `[pending]`, `[granted]`,
`[needs_review]` or `[granted, disabled]`. `doctor` answers "would `serve`
start?" without starting a server, and exits non-zero when the answer is no,
including when a plugin would start and quietly do nothing.

An upgrade never escalates. A package that starts asking for more moves its
record to `needs_review` and **keeps running on the grant it had** — the new
claims are simply not in it — and the digest the record was approved against is
deliberately not advanced while a review is outstanding, or a second start would
settle it silently.

A plugin that fails to load — a missing directory, a version range that
excludes this binary, invalid config, a claim that was not granted, a declared
hook the module does not export — **refuses the start**. It is never skipped
with a warning: an instance that runs, looks healthy, and has quietly stopped
doing what a plugin was installed to do is the worst outcome available.

## Portability

```sh
bun run apps/server/src/main.ts export --dir ./backup               # on-disk tree
bun run apps/server/src/main.ts export --out backup.tar.gz          # reproducible tarball
bun run apps/server/src/main.ts import ./backup --mode merge        # newest updated_at wins
bun run apps/server/src/main.ts import backup.tar.gz --mode replace # replace per collection
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
bun run apps/server/src/main.ts serve --data ./silo_data
cd ui && bun run dev    # hot-reloading admin UI against a running backend
cd ui && bun run lint   # oxlint plus stylelint
```

An empty instance hides most of what the admin UI does, so there is a seeder:

```sh
bun run tools/seed/main.ts --key "$SILO_KEY"
```

It fills a running server over the HTTP API with roughly 5,000 entries across
two projects, three environments each, and 5–20 collections apiece — enough for
paging, ranking, filters and the scope switchers to behave as they would for a
real tenant. `--dry-run` prints the plan without writing, `--help` lists the
flags, and the corpus is a function of `--seed` and `--epoch`, which every run
prints so it can be reproduced. It only ever adds.

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

It rewrites every workspace manifest and commits nothing. `create-silo-plugin`
moves with them for a reason the others do not have: it derives the `"silo"`
range it writes into every scaffolded manifest from its own version, and that
range is the whole plugin compatibility gate. A build that is not a
release reports the version with a `-dev` suffix, so a local `silo version` is
never mistaken for the published artifact of the same number; pushing a `v0.2.0`
tag is what publishes it, and the release refuses a tag that disagrees with the
manifest.

| Path | What it is |
|------|------------|
| `apps/server/` | Bun and Hono backend: `src/core/` (domain, ports, services, schema, transfer), `src/adapters/` (storage, blob, http client), `src/http/` (server, routes, auth, middleware), `src/cli/`, `src/config/`, `src/plugins/`, and `test/` |
| `apps/admin/` | React and Vite admin UI, built to `apps/admin/dist` |
| `packages/shared/` | `@silo/shared` — runtime-neutral rules both the server and the UI depend on: claims, validation errors, schema keywords, key format |
| `packages/create-silo-plugin/` | The plugin scaffolder published to npm as `create-silo-plugin`, with no runtime dependencies of its own. It lives here so its copies of the plugin contract are checked against the originals by silo's own suite |
| `plugins/` | First-party plugins, one workspace package each |
| `tools/` | Build, packaging, seeding and versioning tooling invoked through `bun run` |
| `packaging/` | The Homebrew formula and the dnf package: systemd unit, scriptlets, and repository metadata |
| `docs/` | `context/` — what exists now; `design/` — why it is shaped this way |

The architecture is ports and adapters: `apps/server/src/core/` defines domain
types and the `Storage` and `BlobStorage` interfaces and imports no adapter,
adapters implement them, and the CLI wires everything explicitly from config.
The testing spine is the storage conformance suite in
`apps/server/test/conformance/`, run against both drivers, plus export and
import round-trip tests. Both drivers are held to identical behavior
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
- **A published conformance suite.** [Plugins](#plugins) shipped the extension
  surface itself: a third-party storage or blob adapter registers a driver name
  through the same registry the built-in ones use, and `[storage] driver`
  selects it exactly the way it selects `sqlite`. What is missing is proof. The
  suite that pins what an adapter must actually do runs inside this repo;
  publishing it is what turns "behaves like the built-in drivers" from folklore
  into something a Postgres, git-remote or object-store adapter can run in its
  own CI.
- **Plugin-contributed routes.** `/api/ext/{name}/*` is reserved and answers
  404. A plugin mounting under its own name there, gated by its own claim, is
  what turns an extension into something with a face of its own.
- **Signed plugin packages.** `silo add` already pins by digest and records what
  it verified; a signature policy — trusted publishers, and a refusal to install
  outside them — is the part that does not exist yet.
- **More backup options.** Scheduled and incremental exports, retention
  policies, and pushing an archive straight to a remote target such as an
  S3-compatible bucket, a git repository, or another running silo, instead of
  only writing a local directory or tarball.

Further out, and already designed for rather than built: a sync engine using the
`rev` and `seq` metadata every entry already carries, tombstones so deletions
propagate through a merge, key expiry, and relation integrity enforcement.

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
