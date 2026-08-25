# silo — Living Context

> **This is the entry point for anyone — human or AI — touching this repo.**
> It describes what exists *right now*, not what's planned. If your change
> alters behaviour, architecture or the repo layout, update this file **in the
> same change set** — not later. [IMPLEMENTATION.md](IMPLEMENTATION.md) is the
> design spec and rarely changes; this file changes constantly. Don't duplicate
> the spec here — link to it.

## What is silo

A minimal, self-hostable headless CMS. Users define collections with JSON
Schema, get auto-generated forms and a CRUD API, and can move all their data
anywhere via first-class export/import. The differentiator is **portability**:
standard schemas, pluggable storage (SQLite, plain files), and instances that
can be cloned with one command.

## Where things stand

*Last updated: 2026-08-25*

Everything through M5 is built and shipping: collections and JSON Schema
validation, entry CRUD with optimistic concurrency, the query AST and search
(D29/D30), the media catalog (D23), projects and environments (D18–D22), API
keys with claims (D12/D21), export/import and scope-to-scope copy, the admin
UI, single-binary releases with Homebrew and RPM, and plugins with an installer
(D31/D32/D33).

**The most recent change makes plugins granted principals (D34 phase 1,
2026-08-25).** Hook *delivery* is now a claim —
`hooks:<project>/<env>/<collection>:<hook>`, checked before the event crosses
into the worker — closing a hole where a plugin granted nothing could rewrite
every write in the instance. Grants live in a reserved `_plugins` collection,
each approved plugin gets a managed API key whose secret stays host-side, and
`silo plugin grant|revoke` work offline against the data directory.
`silo.toml` still says which plugins load and in what order; the store says what
they may do. **Breaking:** every `[[plugins]]` block now needs a
`hooks:*/*/*:<hook>` claim per declared hook, and the start refuses while naming
them. `/api/ext/` is reserved for plugin routes (D36). See §13.12 in
[docs/design/plugins.md](docs/design/plugins.md).

**Before that, a plugin deadlock was fixed (D33, 2026-08-25).** A hook
that wrote through `ctx` re-entered its own runtime, blocked on the per-plugin
dispatch lock its own caller held, ended at `timeout_ms`, and left the worker
dead with no restart — so the first `ctx` write from a hook was also the last,
and the suite stayed green because the entry landed before the deadlock. Plugin
causality is now a **chain** of the plugins whose hooks are above a write:
`HookBus` skips any plugin already in it, `PluginContext` is stateless, and the
mutex is gone. Nothing about the plugin-facing payload changed. See
[the changelog](docs/context/changelog.md) and §13.5/§13.9 in
[docs/design/plugins.md](docs/design/plugins.md).

**The rest of D34–D36 is decided but not built:** the management API and audit
log (phase 2), `ctx` as the in-process HTTP API (phase 3, gated on a
route-authority audit), a supervisor for live enable/disable/revoke (phase 4),
the admin UI (phase 5), and plugin routes under `/api/ext/{name}/*` (phase 6).
§13.11 has the shape and the phases.

**The change before that was a repository restructure (2026-08-25).** The tree
moved to a workspace layout — `apps/server`, `apps/admin`, `packages/shared`,
`packages/create-silo-plugin`, `plugins/`, `tools/`, `docs/` — and the code was
decomposed to match: `Service` became `SiloService` plus seven per-subject
services, both storage adapters split per table, the CLI split into flags,
routing and wiring, `ApiClient` became `SiloApi` over per-resource clients, and
the largest UI views were broken into data hooks and components. Behaviour is
unchanged and the full suite passes throughout. See
[the changelog](docs/context/changelog.md) for the entry, and
[the repo map](docs/context/repo-map.md) for where things are now.

## Reading order

| Document | What it answers |
|----------|-----------------|
| [docs/context/architecture.md](docs/context/architecture.md) | How the pieces fit together, in one minute |
| [docs/context/repo-map.md](docs/context/repo-map.md) | Where everything lives |
| [docs/context/code-design.md](docs/context/code-design.md) | How code here is expected to be shaped |
| [docs/context/changelog.md](docs/context/changelog.md) | Every change that altered behaviour, architecture or layout, newest first |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | The vision, the D1–D36 decisions log, and the index into `docs/design/` |
| [README.md](README.md) | How to run, configure and use silo |

## Working in this repo

```bash
bun install
bun test
bun run start                    # the server, from source
bun run --cwd apps/admin dev     # the admin UI against a running server
bun run build                    # the single-file binary
```

Never `git add`, `git commit` or `git push` here — staging and committing are
the author's. Leave the working tree dirty.
