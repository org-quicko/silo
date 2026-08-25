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

**The most recent change completes the plugin redesign (D36, 2026-08-25).** Two
manifest fields replace two, and the pair is what a grant screen is made of:
`contributes` is **what a package will do** and `permissions` is **what it needs
in order to do it**. `kind` is gone — an enum has one value, so it forced a
package that wanted a background timer to invent a hook merely to be called and
forbade a storage provider from registering the hook that keeps its own derived
data in step. A package now contributes any of hooks, routes, a `runtime`
(`activate(ctx)`/`deactivate(ctx)`) and providers, each provider **naming its own
entry module** because it is imported into the host before storage exists while
the rest of the package runs in a worker afterwards. `activate` costs no claim —
it is reachable by nobody but silo and its `ctx` is the same claim-checked surface
a hook's is — and it runs as a step *after* the app is attached, since at the
moment a worker starts there is nothing for a `ctx` call to dispatch against.
Permissions split into `required` and `optional`, each carrying the author's
`reason`, and **the default grant is `required`** across the CLI, the API and the
grant form: approving everything asked for would make `optional` meaningless.
`required` is stored in the record (D38's rule: the management API never reads
the filesystem) and joins the manifest digest, because promoting an optional claim
changes what a default grant approves without changing a single claim in the list.
The five retired keys refuse the start by name. **D37's F6 is closed** with
`collection.afterDelete` — one event per erased collection carrying the count and
whether the scope above it went too, dispatched outside the write lock, so
auditing and mirroring plugins finally see entries go. A live pass found three
more, and every one was a *report* rather than a behaviour: a failing `activate`
named neither the plugin nor activation, a live narrowing below `required` was
silent though the start warns, and `silo plugin list|info` printed the **record's
raw state** — D40's `/api/plugins` defect exactly, in the other caller of the same
fix. See §13.19 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that came plugin routes (D36, phase 6, 2026-08-25).** A plugin declares routes in its manifest and silo
serves them under `/api/ext/{name}/*` behind a new `http:route` claim. A handler
gets the same `ctx` a hook does, so it acts with **the plugin's** authority and
never the caller's — which is what a plugin route *is*, and which is why
`http:route` is a claim, why `auth: "public"` is declared per route and shown
beside the grant, and why the caller's credential headers are withheld from the
handler. The routes are **data silo matches**, never registrations: one
`app.all("/api/ext/*")` resolved through `PluginSupervisor` per request, so a
plugin cannot shadow or reorder a silo route and phase 4's enable, disable,
revoke and rescan apply to routes exactly as they do to hooks. A plugin reaching
its own route is refused by D33's causal chain rather than by a new counter. See
§13.18 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that, verifying phases 4 and 5 against a running instance found that a
post-commit hook's refusal reached the caller (2026-08-25).** A plugin granted hook delivery but not the claim its `ctx` write needs
made an ordinary entry write answer **403 on a request that had already
succeeded**, quoting a claim the *plugin* lacked to a caller who neither needed
nor lacked it — and the refusal never reached the log, so the operator who had
just narrowed that grant saw nothing while the client saw the wrong thing.
`HookBus.run` asked what class the error was before asking whether the hook was
terminal, so `HookNames.Terminal`'s own rule held for faults and not for
refusals; the fix is the order of the two questions. It dates from D31, but
phase 5 offers the narrowed grant as a checkbox and phase 4 applies it live —
shipping a UI for an operation changes how often its edge cases are reached. See
§13.9 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that came the plugin admin UI (D40, phase 5,
2026-08-25).** `Settings → Plugins` lists what has a record and each plugin's
page is where a grant is approved or narrowed, withdrawn, paused, restarted,
reconfigured and read back — the settings form generated by RJSF from the
manifest's own schema, which D31 carried at 1.0 for exactly this. Phase 4 is
what makes it worth building: before the supervisor every control here would
have ended in "restart the server to find out". **Hook delivery leads the
grant**, because a plugin handed `entry.beforeValidate` rewrites everything
written to a collection and the shorter-looking string is the larger authority.
Rendering it found three shipped defects a reporting surface had been hiding:
the claim summary dropped `hooks:` claims **entirely** (two of them beside one
`entries:read` summarised as "read entries"), `/api/plugins` reported only the
`_plugins` record so a plugin granted through `silo.toml` read as approved for
nothing while it was answering `ctx` calls, and the view carried nothing the
manifest declares. A live pass found a fourth. See §13.17 in
[docs/design/plugins.md](docs/design/plugins.md).

**Before that came the supervisor: plugin authority and lifecycle
change without a restart (D39, phase 4, 2026-08-25).** A `ResolvedGrant`
stopped being *copied* — it was captured on `PluginRuntime`, where `HookBus`
decides delivery, and again inside `PluginContext`, where it becomes the
injected principal — and `PluginAuthority` makes it **one cell with two
readers**, so `set` is the whole of live revocation and nothing is torn down.
That is why the fix is a box rather than a reload engine, and why §13.11's
acceptance test now passes as a file: revoke live, and *both* `ctx` calls and
hook delivery stop, each provable alone. `PluginRegistry` became a mutable
ordered set that only `PluginSupervisor` mutates. Four verbs landed —
`PATCH`/`DELETE /api/plugins/{name}/config` behind `plugins:configure`,
`POST .../restart` and `POST /api/plugins/rescan` behind `plugins:enable` — and
`restart_required` is **deleted**, replaced by a `runtime` block that says
`running | stopped | failed` with the reason. Building it produced one rule that
does not point the same way twice: *the record must never describe a state the
next `serve` cannot reach*, so enabling starts before it writes and disabling
writes before it stops. See §13.16 in
[docs/design/plugins.md](docs/design/plugins.md).

**Before that, `ctx` became the HTTP API (D35, phase 3, 2026-08-25).**
A plugin's `ctx` call is now a request against the same Hono app a network
request hits, carrying a principal the host attaches under a module-private
symbol that nothing arriving over a socket can reach — so `AuthMiddleware` and
`RouteAuth` decide what a plugin may do, and `PluginContext`'s five hand-rolled
claim checks are **deleted rather than widened to forty**. The middleware reads
that principal *before* the `--no-auth` branch, which is D37's fifth finding:
otherwise every plugin on every development instance would have silently held
root. `ctx` is confined to `/api/`, D33's causal chain rides the same slot so a
plugin's HTTP-shaped write still cannot re-enter its own hooks, and a call is
bounded by what is left of its dispatch's budget so a slow route rejects the
*call* instead of killing the worker. The typed client over `ctx.fetch` and the
`silo:api` declarations are both emitted from one `PluginApiContract`. See
§13.15 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that, plugin management got an API and authority changes a
trail (D38, phase 2, 2026-08-25).** `/api/plugins/` stops being a reserved 404:
list, read, grant, revoke, enable and disable, all against the `_plugins` record
and never the filesystem, with `If-Match` required on every mutation — because a
grant means approving *what you read*. A fourth system collection, `_audit`,
records who changed what, written by the services so the offline CLI is in it
too and read through `GET /api/audit` behind a new `audit:read` claim. Keys now
carry `parent_id` and revoking one revokes its descendants, closing D37's fourth
finding. `enabled` is orthogonal to the grant — pausing is not un-approving — and D39
made it take effect immediately. See §13.14 in
[docs/design/plugins.md](docs/design/plugins.md).

**Before that came the route-authority audit (D37, 2026-08-25),** the
gate D35 put on phase 3 — and it changed the shipped API rather than only
describing it. `?force=true` on a collection, environment or project delete now
also requires `entries:delete` at the reach it erases; `DELETE /api/keys/{id}`
is bounded by `canDelegate` against the target's claims, because a key holding
*only* `keys:revoke` could revoke root and lock the instance out; and
`keys:create`, `keys:revoke` and `keys:import` joined the claims a plugin may
never be granted — `keys:import` plants a `_keys` row whose hash the author
chose, which is root with no grant at all. Four findings are recorded and
deferred to the phase that owns each, and two properties phase 3 rests on are
now assertions rather than assumptions. See §13.13 in
[docs/design/plugins.md](docs/design/plugins.md).

**Before that, plugins became granted principals (D34 phase 1,
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

**D34–D36 are complete, and so is D37's finding list.** Every phase has landed
and the `contributes` restructure that phase 6 deferred is §13.19, which closed
F6 with it. §13.11 has the shape and the phases.

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
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | The vision, the D1–D40 decisions log, and the index into `docs/design/` |
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
