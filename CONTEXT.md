# silo — Living Context

> The entry point for anyone, human or AI, working in this repo. It says what
> exists **now**, in short. Keep it short: the detail belongs in the files it
> links to, and the history belongs in
> [resources/context/changelog.md](resources/context/changelog.md). Update it
> in the same change set as any change to behaviour, architecture or layout.

## What is silo

A minimal, self-hostable headless CMS. You define collections with JSON Schema
and get generated admin forms and a CRUD API. You can move all the data
anywhere with export/import. What sets it apart is **portability**: standard
schemas, pluggable storage, and one command to clone an instance. The vision
and every decision (D1–D107) are indexed in [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Where things stand

*Last updated: 2026-10-14. Version 1.5.0 (root `package.json`, D28).*

**Stack.** Bun + TypeScript in one workspace: `apps/server` (CLI, Hono HTTP
API, core, adapters), `apps/admin` (React, embedded in the executable),
`packages/shared`, three published clients, and first-party plugins in
`plugins/`. The internal docs are in `resources/` (`context/`, `design/`,
`guide/`, `openapi.json`); `docs/` is the public Mintlify site.
[repo-map.md](resources/context/repo-map.md) says where everything lives.
[architecture.md](resources/context/architecture.md) says how it fits together.

**What is built:**

- **Core.** Entries are JSON documents in an envelope (ULID `id`, `rev`, `seq`),
  addressed by project / environment / collection. Projects, environments and
  collections are ULID-keyed records that can be renamed (D51); a collection
  name may have 128 characters, a project or environment 64 (D104). The schema is
  enforced on every write path, and a collection's schema is frozen while it
  holds entries (D70). Filters use a JSONPath subset (D29). Environment
  variables are substituted as `{{NAME}}` on read (D57).
- **Storage.** SQLite (default; scans run on a read worker, D81), plain files
  (whose layout *is* the export format, D5) and Postgres (D93–D96: pool,
  retries, owner lock, TLS, native search; hardened by a stress review in
  D102–D103: a pool Bun broke is replaced, only the owner shapes the index).
  All three pass one conformance suite with a strict query contract (D92).
  Search is FTS5, `PgSearcher`, or `ScanSearcher` for any other store.
  SQLite and Postgres can also commit many writes as one, behind
  preconditions (`AtomicStorage`, D107); the fs adapter cannot.
- **Auth.** API keys with claims (`collections:<p>/<e>/<name>:<perm>`, prefix
  segments like `acme-*`, D64). A root key is printed at first boot. Keys are
  editable (D63). [resources/guide/claims.md](resources/guide/claims.md) has
  the grammar.
- **Media.** A catalog (`_media`) over fs or S3 blob storage (D23, D45).
  References are `silo://media/<id>`. Blob keys are `media/<id>` (D88). Media
  is streamed with `Range` support (D80) and sandboxed on serve (D83).
  `?download=true` sends any type as an attachment (D100). `/media/*` allows
  any origin to read (D101). Force delete, purge and in-place replace exist,
  each behind its own claim. The admin uploads a whole folder, from a picker
  or a drop, and recreates its subfolders (D105). A selection downloads as
  itself (one file) or as streamed ZIP parts of up to 2 GiB behind a ticket,
  at most 5000 files and 5 GB, three parts at once, all three settable in
  `[media]`; `GET /api/media/stats` totals the library for the admin's
  stats modal (D106).
- **Transfer.** Export, import, server-to-server copy and scope copy, with
  `include` selections and media modes (D74). They are streaming and
  memory-flat (D73, D76–D78), size-bounded (D85), and gated per system
  collection (D84). NDJSON progress is opt-in (D75). `silo export --instance`
  moves a whole instance across storage drivers (D97).
- **Plugins.** A plugin is a granted principal whose `ctx.fetch` goes through
  the real API (D34–D39). Plugins install and uninstall from the API or with
  `silo add` (D32, D42, D43), expose routes under `/api/ext/{name}/*`, and can
  add a sandboxed admin panel (D41). First-party plugins: the Strapi importer
  and observability (D52, D98, D99).
- **Configuration.** `silo.toml`, `SILO_*` variables and flags. Most tables are
  editable from the admin, which says when a restart is owed (D45–D47, D50).
  [resources/guide/configuration.md](resources/guide/configuration.md) lists
  every setting.
- **API surface.** REST under `/api`
  ([resources/openapi.json](resources/openapi.json) is hand-written and must be
  kept in step), MCP at `POST /api/mcp` plus the `silo mcp` stdio bridge
  (D86), and clients for TypeScript (D61, D71), Java (D69, D87) and Dart
  (D91).
- **Admin UI.** A server manager, then collections, entries, media, transfer and
  settings. Server state lives in one stale-while-revalidate store (D53). A
  saved server whose key is refused opens prefilled in the server dialog, so
  the key is replaced there.
- **Distribution.** Compiled executables, signed checksums, a Homebrew tap, a
  dnf repository, and a multi-arch image on Docker Hub and GHCR (D26–D28, D90).
  Only `vX.Y.Z` tags release. `packaging/compose/` runs silo beside Postgres.

**Open work:**

- Security audit of 2026-09-18: C1–C5 and H1–H6 are fixed (D79–D85). H7–H15
  and the medium findings are still open. The report is not in the repo.
- Changing a schema over existing entries is deferred until a migration plan
  exists (D70).
- Roadmap items (sync, drafts/publish, durable webhooks, enforced relations)
  are in [milestones.md](resources/design/milestones.md) §12.
  [IDEAS.md](IDEAS.md) holds loose ideas.

**Most recent changes:** the storage port gained an optional atomic commit
(D107), the first step of moving selected content between instances; a server
whose saved key is refused opens in an edit dialog from the server picker,
instead of a banner that needed `localStorage` cleared; the internal docs moved
from `docs/` to `resources/`, and every link to them now points there. Read the
top of the [changelog](resources/context/changelog.md) for more.

## Reading order

| Document | What it answers |
|----------|-----------------|
| [resources/context/architecture.md](resources/context/architecture.md) | How the pieces fit together |
| [resources/context/repo-map.md](resources/context/repo-map.md) | Where everything lives |
| [resources/context/code-design.md](resources/context/code-design.md) | How code here is shaped, and test-suite pitfalls |
| [resources/context/changelog.md](resources/context/changelog.md) | Every notable change, newest first |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Vision, the decision index, and the index into `resources/design/` |
| [resources/design/decisions.md](resources/design/decisions.md) | Each decision in full: choice and rationale |
| [resources/guide/](resources/guide/README.md) | How to run, configure and extend silo |

## Working in this repo

```bash
bun install
bun run --cwd packages/silo-client build   # the admin resolves the client's dist/
bun test                                   # from the repo root
bun run typecheck
bun run start                              # the server, from source
bun run --cwd apps/admin dev               # the admin UI against a running server
bun run build                              # the single-file executable
```

- Postgres tests run only when `SILO_TEST_PG_URL` is set. See
  [code-design.md](resources/context/code-design.md) (Tests).
- A change to a route, parameter, body, response or claim updates
  `resources/openapi.json`, `resources/guide/http-api.md` and
  `resources/design/http-api.md` together.
- Never `git add`, `git commit` or `git push` here. The author stages and
  commits. Leave the working tree dirty.
