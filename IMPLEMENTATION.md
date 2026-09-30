# silo — Implementation Document

**One-liner:** a minimal, self-hostable headless CMS in one Bun executable.
Define collections with JSON Schema, get generated forms and a CRUD API, and
move all the data anywhere with export/import.

## 1. Vision

Pocketbase already owns "single binary + SQLite + admin UI". silo exists for
**portability**:

- Schemas are **standard JSON Schema**, not a private DSL.
- Storage is **pluggable**: SQLite, plain files (git-friendly), Postgres.
- **Export/import is the headline feature.** Any instance can be cloned, backed
  up or moved with one command, and the export format is the fs adapter's own
  on-disk layout.

Where Pocketbase optimises for features, silo optimises for data that is
trivial to move.

**Stack:** Bun + TypeScript, Hono for HTTP, `bun:sqlite` / `Bun.SQL`, a React
admin embedded in the executable. D9–D11 below describe an earlier Go design
and are superseded by it.

## 2. Decisions

The full rows (choice and rationale) are in
[docs/design/decisions.md](docs/design/decisions.md). Read the row before you
change what it decides. A new decision gets a full row there and one line here.

| # | Decision |
|---|----------|
| D1 | Document model: a JSON blob in an envelope, never schema→table mapping |
| D2 | Entry ids are ULIDs |
| D3 | Schemas are full JSON Schema draft 2020-12 |
| D4 | Admin is a React SPA with RJSF forms, embedded in the executable |
| D5 | Export format = the fs adapter's on-disk layout (frozen, public) |
| D6 | Replication is one-shot export/import only; `rev`/`seq` are sync-ready |
| D7 | No cache adapters, not even the interface |
| D8 | Auth is API keys with explicit claims; anonymous collection reads are open unless `x-silo-auth: true` |
| D9–D11 | Go driver, router and CLI choices. *Superseded by the Bun/TS stack* |
| D12 | Keys live in the reserved `_keys` collection, SHA-256 hash only, secret shown once |
| D13 | No API versioning: plain `/api` routes |
| D14 | One `FormatVersion` (`"1"`), stamped everywhere; an unknown version is refused on import |
| D15 | Flat projects. *Rejected, replaced by D18* |
| D16 | `BlobStorage` port with fs and S3 adapters |
| D17 | Server-to-server copy is the destination composing export + import |
| D18 | A collection is addressed by `(project, env, collection)` |
| D19 | Scoped routes and scoped claims `collections:<p>/<e>/<name>:<perm>` |
| D20 | Projects and environments are separate, explicit records |
| D21 | Transfer claims also need instance-wide collection authority |
| D22 | Scope-to-scope copy route inside one instance |
| D23 | Media catalog (`_media`), folders, `silo://media/<id>` references, reference integrity |
| D24 | Transfer also needs media claims |
| D25 | One server per data directory: `silo.run.json`, `--detach`, `stop`/`status`/`logs` |
| D26 | One build path (now `tools/build/`), embedded UI, signed checksums, Homebrew tap |
| D27 | dnf: a signed repository on GitHub Pages |
| D28 | The version lives only in the root `package.json` |
| D29 | Filter and sort address fields with an RFC 9535 JSONPath subset |
| D30 | Search is a `Searcher` port: `ScanSearcher` everywhere, FTS5 on SQLite |
| D31 | Plugins: a closed contract, loaded from config, isolated in workers |
| D32 | `silo add` installer with integrity pinning and a lockfile |
| D33 | Plugin causality is a chain, not a depth counter |
| D34 | A plugin is a granted principal: `_plugins` records plus a managed key |
| D35 | Plugin `ctx` is `fetch` against the real Hono app |
| D36 | Plugins declare `contributes`; plugin routes live under `/api/ext/{name}/*` |
| D37 | Every route asks for the authority its effects exercise |
| D38 | Plugin management API and an `_audit` trail |
| D39 | `PluginSupervisor`: grants and lifecycle change without a restart |
| D40 | Admin grant screen for plugins |
| D41 | Plugin routes can take bytes; a plugin can contribute a sandboxed admin panel |
| D42 | Install plugins from the API; the config block carries no claims |
| D43 | Uninstall plugins from the API |
| D44 | Plugin page = summary plus four sheets |
| D45 | Media storage editable from the admin; `silo.toml` stays the source of truth |
| D46 | `[media]` table: public URL base and upload allowlist |
| D47 | Rest of `silo.toml` editable from the admin, with restart-owed reporting |
| D48 | Media force-delete, bulk delete, and `null` for a deleted asset's references |
| D49 | Force-delete needs `entries:update` where it reaches; folder rename/move/delete; purge |
| D50 | `SILO_CONFIG`, and a writability check before the API writes the config |
| D51 | Projects, environments and collections are ULID-keyed, so names can be renamed |
| D52 | Observability: a bounded core snapshot rendered by a first-party plugin |
| D53 | Admin keeps server state in one stale-while-revalidate store |
| D54 | Collection listings carry summaries, not schemas; `countEntries` on the port |
| D55 | Media Type/Modified filters; one global snackbar |
| D56 | Settings pages share one layout language (no cards) |
| D57 | Environment variables: declared per project, valued per env, `{{NAME}}` substituted on read |
| D58 | The store decides a media URL's shape; `media:read` retired |
| D59 | `[blob_storage] public_read` for private buckets |
| D60 | A set `base_url` always uses silo's `/media/<id>` route |
| D61 | TypeScript client `@org-quicko/silo-client` (§14) |
| D62 | Entries are the flat wire object; reserved field names are refused on input |
| D63 | API keys are editable (`PATCH /api/keys/{id}`) |
| D64 | Claim scope segments may be prefix patterns (`acme-*`) |
| D65 | `media:purge` claim for emptying the library |
| D66 | Media Rename and Move are separate actions; Move uses a tree picker |
| D67 | Replace an asset's bytes in place (`media:replace`) |
| D68 | Strapi importer: one session per caller |
| D69 | Java client `in.org.quicko.silo:client` (§15) |
| D70 | Schema is enforced on every write path; a schema with entries is frozen |
| D71 | Opt-in collection GET caching in the TS client |
| D72 | `[http] idle_timeout`, default 120 s |
| D73 | Export streams the archive as it walks (own `TarWriter`) |
| D74 | Transfer selection (`include`) and media modes (`all`/`referenced`/`none`) |
| D75 | NDJSON progress stream on import and copy |
| D76 | Export memory is flat (`node:zlib`, flush budget) |
| D77 | Import reads entries lazily |
| D78 | Import spools the upload to disk before extracting |
| D79 | Request body ceilings (`max_body_size_mb`, `max_json_body_size_mb`) |
| D80 | Media is streamed, with `Range` support |
| D81 | SQLite scans run on a read worker thread; filter cost is capped |
| D82 | Run-file liveness by identity (boot id, heartbeat), not pid |
| D83 | Bytes silo did not write are sandboxed (`nosniff`, CSP, attachment) |
| D84 | Import gates each `_system` collection on its own route's claims |
| D85 | Import is size-bounded, locks only its load, never empties before filling |
| D86 | silo is an MCP server (`POST /api/mcp`, `silo mcp`) |
| D87 | Java client response cache via `@Cache` (Caffeine) |
| D88 | Blob key is `media/<assetId>`; `silo media rekey` |
| D89 | Transfer scope picker opens empty; per-column select-all |
| D90 | Releases publish a multi-arch image to Docker Hub and GHCR |
| D91 | Dart client `silo_client` |
| D92 | One query contract for every adapter: type-strict, codepoint order, type-ranked sorts |
| D93 | Postgres adapter `PgStore` |
| D94 | Postgres is selectable and resilient (pool, retries, owner lock) |
| D95 | `PgSearcher`: native Postgres search |
| D96 | Postgres TLS via libpq URL parameters (`PgTls`); Postgres in CI |
| D97 | Changing driver is `silo export --instance` + `silo import`; no migrate command |
| D98 | Compose file for silo + Postgres; Database card in observability |
| D99 | Request log names the key; metrics name endpoints within the caller's reach |
| D100 | `/media/{id}?download=true` forces `attachment`; the admin's Download link uses it |
| D101 | `/media/*` allows any origin for `GET`/`HEAD`; the text preview reads silo's route |
| D102 | A Postgres pool the driver broke is replaced; a key storage cannot look up is a 503, not a 401 |
| D103 | Postgres: lifetime off, heartbeat deadline and keepalive, only the owner shapes the search index, race-safe reindex, Bun 1.4.2 |
| D104 | Collection names may have 128 characters (`CollectionName`); the name is checked before the claim |
| D105 | The admin uploads a folder from a picker or a drop and recreates its subfolders from the paths; names are checked up front by a shared `MediaFolderName`, a refused file is skipped |
| D106 | `MediaFileUrl` now refuses to hand out anything but an `http(s)` URL, closing the gap CodeQL found in the media preview's download link |

## 3. Scope

**In 1.0:** collections, validated entry CRUD, query/filter/sort/pagination,
the admin UI, export/import, SQLite and fs storage, key auth with claims,
single-binary releases, plugins. Everything since (media, search, Postgres,
clients, MCP) is listed above.

**Not built (roadmap, [milestones.md](docs/design/milestones.md) §12):** sync
engine, cache adapters, drafts/publish, durable webhooks, enforced relations,
auth providers, GraphQL, editing a schema over existing entries.

## 4. Design documents

Section numbers are stable, so a comment citing §13.5 still resolves.

| Section | Document |
|---------|----------|
| Decisions, in full | [docs/design/decisions.md](docs/design/decisions.md) |
| §4 Architecture | [docs/design/architecture.md](docs/design/architecture.md) |
| §5 Core concepts: entries, schemas, the query AST, search | [docs/design/core-concepts.md](docs/design/core-concepts.md) |
| §6 Storage adapters: the port, SQLite, fs, Postgres | [docs/design/storage.md](docs/design/storage.md) |
| §7 Export, import and copy | [docs/design/transfer.md](docs/design/transfer.md) |
| §8 HTTP API, including media and MCP | [docs/design/http-api.md](docs/design/http-api.md) |
| §9 Admin UI | [docs/design/admin-ui.md](docs/design/admin-ui.md) |
| §10 Configuration and the CLI | [docs/design/configuration.md](docs/design/configuration.md) |
| §11–12 Milestones and roadmap | [docs/design/milestones.md](docs/design/milestones.md) |
| §13 Plugins | [docs/design/plugins.md](docs/design/plugins.md) |
| §14 The TypeScript client | [docs/design/api-client.md](docs/design/api-client.md) |
| §15 The Java client | [docs/design/java-client.md](docs/design/java-client.md) |
