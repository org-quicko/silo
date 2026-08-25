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

**The most recent change fixes a plugin deadlock (D33, 2026-08-25).** A hook
that wrote through `ctx` re-entered its own runtime, blocked on the per-plugin
dispatch lock its own caller held, ended at `timeout_ms`, and left the worker
dead with no restart — so the first `ctx` write from a hook was also the last,
and the suite stayed green because the entry landed before the deadlock. Plugin
causality is now a **chain** of the plugins whose hooks are above a write:
`HookBus` skips any plugin already in it, `PluginContext` is stateless, and the
mutex is gone. Nothing about the plugin-facing payload changed. See
[the changelog](docs/context/changelog.md) and §13.5/§13.9 in
[docs/design/plugins.md](docs/design/plugins.md).

**D34–D36 are decided but not built.** Plugins become granted principals — a
`_plugins` record, a managed API key per plugin, claim-gated *hook delivery*,
`ctx` as the in-process HTTP API, contributions in place of the two kinds, and
`/api/ext/` reserved for plugin routes. Two shipped holes drive it: hook
delivery is not claim-checked at all, and a grant may exceed what a manifest
requested. §13.11 has the shape and the phases.

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
