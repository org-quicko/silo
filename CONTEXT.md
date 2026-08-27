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

*Last updated: 2026-08-27*

Everything through M5 is built and shipping: collections and JSON Schema
validation, entry CRUD with optimistic concurrency, the query AST and search
(D29/D30), the media catalog (D23), projects and environments (D18–D22), API
keys with claims (D12/D21), export/import and scope-to-scope copy, the admin
UI, single-binary releases with Homebrew and RPM, and plugins with an installer
(D31/D32/D33). Plugins now also take byte bodies and contribute admin
panels, and there is a first-party plugin using both to import a Strapi 5 export,
media included (D41). Plugins install *and uninstall* from the API and the admin
(D42/D43), and a plugin's page is a summary with its sections behind sheets so
the plugin's own panel has room (D44).

**The most recent change lets a plugin be uninstalled without a shell, and
rebuilds the page it is uninstalled from (D43/D44, 2026-08-27).**
`DELETE /api/plugins/{name}` takes a plugin off an instance whole: its
`[[plugins]]` entry, its worker, its record, its managed key and its package.
Same claim as install (`plugins:enable`), and `If-Match` fenced wherever there is
a record to fence — a package that never got one has no revision to send, and
demanding one would make it unremovable through the API that installed it. **The
order is D42's read backwards**, on the same rule: un-list first and fail hard if
that cannot be done, because a block naming a package that is gone does not fail
that plugin but the whole process; then stop the worker; then forget the record,
which discards the managed key, so a re-installed package comes back approved for
nothing; then delete the files, forgiving a failure. `PluginBlockWriter.remove`
edits the file as text like `append` does and parses the result before writing
it, because a span one table short re-parents a `[plugins.config]` onto the next
plugin. The audit entry outlives the record, since `withdrawn` is the only place
what the plugin could do is written down once the record is gone.

The plugin's page was rebuilt around it (D44). Its four sections — grant, routes,
config, trail — were all open at once, which on a real package is eight claims,
eleven routes, a generated form and an audit trail stacked above the plugin's own
panel, so an operator arriving to *use* one scrolled past all of it. Each is now
a right-hand `Sheet` opened from a button carrying that section's state
(`4 of 8 claims`, `11 routes · 2 public`), which keeps D40's property that the
page answers *is anything waiting on me* unopened. The panel gets the page and a
full-screen mode. Three panel bugs surfaced doing it: the height measurement read
`documentElement.scrollHeight`, which is at least the viewport and therefore the
height the admin had just granted, so a panel could only ever grow and a
collapsed one left a **white** band below it — white because a frame's base
canvas is, and the panel document painted nothing; and the `ResizeObserver` was
never retained, so it was collected and stopped reporting silently. See §13.22 in
[docs/design/plugins.md](docs/design/plugins.md) and §10/§10a in
[docs/design/admin-ui.md](docs/design/admin-ui.md).

**Before that, a plugin became installable without a shell (D42, 2026-08-27).**
`POST /api/plugins/install` acquires a package — npm spec, git URL, HTTPS tarball,
local path, or an uploaded `.tgz` — checks it, starts it, grants it and appends
its `[[plugins]]` block, behind `plugins:enable`. The admin gets an Install
dialog beside "Re-read silo.toml". D34 had reserved this namespace for grants and
lifecycle, on the argument that an API able to write that block is a
code-execution primitive wearing a management claim; the argument was right and
the conclusion had been overtaken, because `rescan` has started arbitrary listed
code on a `plugins:enable` key since D39. That claim *is* the primitive, and
withholding the install only cost an operator on a managed platform a terminal
they do not have. **What is kept is the half worth keeping: the block is written
with `claims = []`.** Effective authority is the file unioned with the record,
and only the record half passes `assertGrantable` and `canDelegate`, is audited,
and can be withdrawn — so a block carrying claims would be a grant no check ever
sees, on this install and on every start after it. The order is the rest of the
design and the first cut had it inverted, running side effects before checks: a
key holding only `plugins:enable` installed a plugin with three claims it could
not delegate and read a 403 while that plugin's route answered 200; a manifest
requiring `keys:create` — which no plugin may ever hold — got it; and a default
install of any package declaring routes or hooks wrote its block and *then*
failed to start, leaving a `silo.toml` the next `serve` refuses to boot on.
`PluginInstallation` now refuses before fetching, refuses before running, starts
ungranted, grants, and writes the block **last**, undoing the package on any
earlier refusal. See §13.21 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that came a media thumbnail resolution fix in the admin entries grid (2026-08-27).**
`CellValue.tsx` rendered media thumbnails using `<img src={asset.url} />` where `asset.url` is
server-relative (`/media/<id>`). When connecting to remote servers or running under the Vite dev server
(port 5173), thumbnails failed to load due to 404s against the admin host. The active server's base URL
is now threaded from `EntriesView` through `EntriesTable` into `CellValue` and prefixed to `asset.url`
consistent with `MediaCard`, `MediaRow`, and `MediaWidget`.

**Before that came silo's first first-party plugin, and the three
things in the plugin system it needed (D41, 2026-08-27).**
[`plugins/silo-plugin-strapi-import`](plugins/silo-plugin-strapi-import) imports
a Strapi 5 SQLite export into silo collections from a screen inside the admin,
and writing it found that two of its three requirements were **impossible**
rather than awkward. A plugin route decoded every body as UTF-8 and capped every
route at one global mebibyte, and `ctx.media` is metadata only — so a plugin
whose job is ingesting a file could not be handed one. A route now declares
`"body": { "kind": "bytes", "max_bytes": n }`, `SiloRequest` gained `bytes`
beside `body` with at most one ever filled, and the number is the author's to
state and silo's to bound at 64 MiB, because it is how much the host allocates
for whoever reaches the route. That made the second gap visible: `http:route` is
**one** claim however many routes exist, so a package could add `"auth":
"public"` to a route in a patch release and publish everything it was granted at
an unauthenticated URL against an approval nobody re-read — `routes` now joins
the `_plugins` record and the manifest digest, which moves a plugin *with* routes
to `needs_review` once. Third, `contributes.ui` is the **iframe contract §12.8
deferred**: a package declares one inlined HTML file, `GET
/api/plugins/{name}/ui` serves it as *JSON* with `nosniff`, and the admin makes
it a document in `sandbox="allow-scripts"` with no `allow-same-origin`. That is
not caution — serving it as a document was measured to be a
credential-exfiltration primitive, since the API shares an origin with the admin
SPA and the SPA keeps an API key per configured server in that origin's
`localStorage`. A panel's one capability is asking the admin to call **its own
plugin's** routes with the operator's key, so the panel spends the operator's
authority and the handler spends the plugin's, and no route needs to be public.
Along the way, **D33's guarantee turned out to have a hole**: "a plugin never
hears about a write it caused" was implemented from the *waiter*, which exists
only while its dispatch is open, so background work that outlived its dispatch
was delivered the plugin's own writes.

The importer's **media** half was then designed twice, and the second time found
something about silo. A Strapi export carries the file *catalog* and never the
uploads, and the first version imported a media field as an object mirroring
Strapi's own — which validated, read back correctly, and was **inert**: silo's
media type is `x-silo-type: "media"` on a *string* (D23) and every behaviour keys
off that keyword, so the admin picker, `MediaRefs`' usage guard and the read-time
URL rewrite all passed it by while nothing failed. A media field is now that
string, holding `silo://media/<id>` where the operator supplied the bytes and the
absolute Strapi URL where they did not — same schema either way, so "import now,
send the files later" is a re-import rather than a migration. The bytes arrive
**one file per request**, because the 64 MiB ceiling caps *one request* and a real
`public/uploads` is routinely larger, so the obvious zip route could not carry the
case it exists for. Two things came out of running it: bytes going *into* silo were
reachable through `ctx` all along (`POST /api/media` is inside `/api/` and takes a
multipart body — only *reading* `/media/{id}` is confined away), and `POST
/api/media` **deduplicates nothing**, so a `replace` re-import doubled the media
library until the plugin started matching silo's own sha256 before uploading.
Whether silo should dedupe on `hash` itself is left open. Nothing of Strapi's
identity is carried now — `strapi_id` and the forced `document_id` are both gone,
because silo mints its own (D2) and nothing on either side resolves a Strapi one.

See §13.20 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that, the admin UI's Appearance settings were reworked
(2026-08-26).** It was fonts and a flat accent-colour grid; it is now a
colour-mode toggle (light/dark/system, the system option resolved live against
`prefers-color-scheme`) plus a grouped theme gallery — Featured, Single
colour, and Vision assistive (colour-blind-safe) — where each entry bundles an
accent with the sidebar tint it was designed alongside, so switching themes
now visibly retints the sidebar rather than only the accent. This is also
silo's first light mode: `tokens.css` gained a `[data-theme='light']` block,
and the handful of CSS Modules that had hardcoded a copy of the default
accent's hex (rather than reading `var(--accent)`) were fixed, since those are
exactly the spots a custom accent or a light background would have exposed.
Landed alongside it: `--text-3`, the dark-mode "muted" text token, was too low
a contrast against `--bg`/`--panel`/`--panel-2` to clear WCAG AA for normal
text (~3.5–4.1:1) and is now `#8890a0` (~5–6:1); light mode's own status
colours (`--ok`/`--warn`/`--bad`) are darkened shades of their dark-mode
values for the same reason — the originals fall under 3:1 against white.
Appearance settings remain client-only, in `localStorage`, never sent to a
server. See §9 in [docs/design/admin-ui.md](docs/design/admin-ui.md).

**Before that, the plugin redesign completed (D36, 2026-08-25).** Two
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
