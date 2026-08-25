# Plugins

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 13. Plugins (D31)

Numbered after the roadmap because §12's numbering is referenced from D18, D25,
§5.1 and §7.5; this is a shipping section, not roadmap.

### 13.1 What ships, and what does not

Two kinds:

| Kind | Contract | Runs |
| :--- | :--- | :--- |
| **Provider** | Implements `Storage` or `BlobStorage` (§6.1, D16) | Inline |
| **Extension** | Registers hooks (§13.5) | In a `Worker` |

Deliberately **not** in 1.0, all additive and listed in §12.8: an installer,
HTTP interceptors, plugin routes, plugin CLI subcommands, import/export format
plugins, and admin-UI contributions. `/api/plugins/` is reserved and returns
404; reserving it costs nothing now and cannot be done later.

> **Being superseded (D34–D36).** The two-kind table above becomes a
> `contributes` list, authorization moves from `[[plugins]] claims` into a
> granted `_plugins` record with a managed API key, hook *delivery* becomes
> claim-gated, `ctx` becomes the HTTP API dispatched in-process, and plugin
> routes move to a reserved `/api/ext/{name}/*` so `/api/plugins/*` can be the
> management surface. §13.11 sketches it; the decisions carry the reasoning.
> Everything below this line describes what is **built today** except where it
> says otherwise, and D33 (the causal chain) has already landed inside it.

### 13.2 The manifest is static

Static metadata lives in `package.json#silo` and **must be readable without
executing the plugin** — `silo plugin info` has to show an operator what a
package wants before any of its code runs.

```jsonc
{
  "name": "@acme/silo-plugin-slugs",
  "silo": {
    "silo": "^1",                    // SiloVersion range; checked at startup
    "kind": "extension",             // "extension" | "provider"
    "hooks": ["entry.beforeValidate"],
    "claims": ["collections:*/*/*:entries:read"],
    "config": { "type": "object", "properties": { "field": { "type": "string" } } }
  }
}
```

- `silo` is a range against `SiloVersion` (D28). **There is no separate plugin
  API version** — see D31's rationale and D13, which makes this one comparison
  the whole compatibility gate. Ranges are ordinary npm ranges, evaluated by the
  `semver` package; `VersionRange` adds exactly one rule of silo's own —
  **the prerelease suffix is dropped before comparing.** Every non-release build
  carries `-dev`, and semver admits a prerelease to no range that does not name
  one, so the strict reading would let no plugin load outside a tagged release.
  It is deliberately narrower than `includePrerelease`, which would also admit a
  `2.0.0-rc.1` to a plugin pinned `^1`.
- `config` is a JSON Schema (D3), validated at startup; invalid config
  **refuses the start**, as an invalid default project id does (D20). It is
  carried at 1.0 even though nothing renders it, so the admin settings form can
  be added in 1.x through RJSF with no manifest change.
- There is no `ui` field. Adding one later is additive.

The module's **default export is a descriptor of functions**. Importing it has
no side effects and nothing self-registers, which is what keeps §4's "no
`init()` registration magic — explicit construction only".

### 13.3 Loading, and the `silo:api` virtual module

Resolution: `<data dir>/plugins/<name>/`, or `<data dir>/plugins/node_modules/<name>/`.
Both are accepted so the 1.x installer needs no config change. Plugins live in
the data directory because a packaged binary is root-owned and read-only, and
because D5 makes an instance a directory you can `cp` — so an instance travels
with its extensions.

Plugins reach the host through a **virtual module** registered with
`Bun.plugin()` / `build.module()` before any plugin is imported:

```ts
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async "entry.beforeValidate"(ev, ctx) {
    if (ev.collection !== "posts") return;
    return { data: { ...ev.data, slug: ctx.config.field } };
  },
});
```

A plugin therefore declares **zero runtime dependencies**. Editor support is
`apps/server/src/plugins/host/silo-api-types.d.ts`, which a plugin author copies next to
their plugin — `create-silo-plugin` (§13.8) does that copy for them, and a
drift test holds the two byte-identical. That is automation of the hand-copy,
not a substitute for it: publishing the file as `@silo/plugin-types` is §12.8
work, and whatever carries it must contribute nothing at runtime. This is
what prevents the cross-realm identity problem rather than working around it:
`SiloServer.onError` already uses `ValidationError.is` instead of `instanceof`
because prototype identity is unsafe across the `@silo/shared` boundary, and
every plugin carrying its own copy would have multiplied that.

A plugin that fails to load, or whose `silo` range excludes `SiloVersion`,
**refuses the start**. `silo plugin doctor` loads everything, reports what
fails, and exits without starting a server.

### 13.4 Isolation

Extension plugins run in a `Worker`, one per plugin. This is settled by
asymmetry rather than preference: worker→inline is a relaxation every plugin
survives, inline→worker breaks every plugin written against live objects,
because structured clone admits only plain data. Since 1.0 freezes the surface,
the reversible direction is the only defensible default.

Providers are the exception. Isolating something already trusted with every
byte in the instance protects nothing, and `Storage` is a large, chatty,
stateful port that would pay clone cost per page.

**A `Worker` bounds faults, not malice.** It contains crashes, infinite loops
and memory blowups — a `while(true){}` plugin leaves the host responsive and
terminable. It does not stop plugin code reading the database or opening a
socket: worker code holds full Bun privileges. The trust boundary is the act of
installing, as with npm, VS Code and Strapi. Documented as such, never as a
sandbox.

### 13.5 Hooks

Five, each carrying `op` rather than doubling the set:

| Hook | Kind | May |
| :--- | :--- | :--- |
| `entry.beforeValidate` | **mutating** | replace `data`, reject |
| `entry.beforeWrite` | **veto-only** | reject |
| `entry.afterWrite` | observe | nothing |
| `entry.beforeDelete` | veto-only | reject |
| `entry.afterDelete` | observe | nothing |

Placement in `Service.createEntry` / `updateEntry`:

```
requireUserCollection(scope, collection)
  -> entry.beforeValidate      MUTATING
MediaRefs.canonicalize(data)
schemas.validateEntry(...)
usages = MediaRefs.extract(data)
build envelope { id, rev, seq, timestamps }
  -> entry.beforeWrite         VETO-ONLY
acquire writeMu
    assertMediaReferencable(usages)
    store.put(e, derived)
release
  -> entry.afterWrite          OBSERVE, off the critical path
```

Three rules, each inherited from an existing invariant:

- **Mutating hooks run before validation; post-validation hooks may only
  observe or reject.** Data is canonicalised before validation so the schema
  judges exactly the value that will be stored (§5.1, D23); a hook rewriting
  data afterwards would store something the schema never saw.
- **Plugins shape `data`; the envelope belongs to core.** No hook sets `id`,
  `rev`, `seq` or timestamps — D2 and the change-feed cursor are load-bearing
  for replication and unreachable from a third party.
- **Nothing plugin-shaped is persisted.** Dispatch carries an `origin`
  (`api` | `import` | `plugin:<name>`), but it is context only; writing it into
  the entry would change the on-disk layout and force a `format_version` bump
  (D14) for a debugging convenience.

**A plugin never hears about a write it caused (D33).** Every write carries a
`WriteContext` whose `chain` names the plugins whose hooks are above it —
`[]` for a request, `["slugger"]` for a write slugger's hook made — and
`HookBus` skips any plugin already in it. That makes a cycle *unrepresentable*
rather than merely bounded: `A -> B -> A` cannot form, because A is in the chain
by the time B writes. The chain stays host-side and reaches a plugin only as
`event.depth`, its length: how deeply nested a dispatch is is the plugin's
business, and which other plugins are installed is not.

This replaces a convention with a mechanism. A plugin used to be told to check
`origin` for its own name, which was easy to forget and — decisively — could
never catch the indirect case, since two plugins writing into each other's
collections each see only the *other's* name. It also could not be made safe by
bounding it: the per-plugin dispatch lock that made the old depth counter sound
deadlocked on the very first `ctx` write from a hook, and cost the plugin its
worker. `HookBus.MaxDepth` survives as a cap on how many *distinct* plugins may
chain off one request.

Hooks are domain lifecycle events and **not** HTTP middleware because HTTP is
not where the data enters. `silo import`, `ScopeCopier` (D22) and every CLI
write path would bypass an HTTP-only plugin, so a validation or enrichment
plugin would silently not run on exactly the paths that write the most at once.

**Which write paths dispatch.** Every write through `Service` — the HTTP CRUD
routes, and a plugin's own `ctx.entries.*` calls. The transfer paths
(`Importer`, `ScopeCopier`) deliberately do **not**; see D31's rationale for why,
and `Hooks` in `apps/server/src/core/hooks/` for the same note where a reader of the code
will meet it.

**`entry.afterWrite` is in-process and at-most-once.** It fires outside
`writeMu`, best-effort, and a failure is logged and dropped. Durable
at-least-once delivery needs the change feed (§12.1); no `seq` cursor is
exposed to plugins, because doing so would freeze a cursor contract before the
sync design that owns it exists (D7).

Order is the order of the `[[plugins]]` array — config-owned, deterministic,
and debuggable.

### 13.6 The plugin context, and capabilities

A plugin acts only through `ctx`, never `Storage` or `Service`. Every call is
checked against the claims the manifest requested and the operator granted,
using the existing `Claims`/`ParsedClaim` machinery including scoped wildcards
(D8, D19). A plugin cannot widen its own reach, and its actions are auditable
in the same vocabulary as a key's — **a plugin is an API key with code
attached.**

**D31 added no new claim strings**, because there was no install API for one to
guard. **D34 adds five**, because there now is.

`plugins:read`, `plugins:configure`, `plugins:grant` and `plugins:enable` are
ordinary fixed claims. Only `root` carries the last two by preset: `canDelegate`
means an approver can hand over only what it holds, so keeping them out of
`manage` makes empowering a plugin a deliberate grant rather than a side effect
of picking the second-widest preset. A **plugin** may never hold any of them,
nor root — it runs code, so it could widen its own grant and then act on it, and
that is refused when approving rather than when calling, so it is visible to
whoever is deciding.

The fifth is a new *shape*, and it closes a hole rather than adding a feature:

```
hooks:<project>/<env>/<collection>:<hook>
```

Hook **delivery** was not claim-checked at all. `HookBus` dispatched to any
runtime that declared a hook, so a plugin granted nothing could declare
`entry.beforeValidate` and see — and rewrite — every entry write in the
instance. The claim system governed `ctx` and not the strictly larger authority
beside it.

Three things follow, and each is deliberate:

- **It is its own shape, not an `entries:*` permission.** Being handed a value
  before it is validated is not reading a committed one, and neither claim
  satisfies the other in either direction.
- **The check runs before the event crosses into the worker**, not inside it and
  not afterwards. A check after delivery is an audit trail; a boundary has to be
  where the data would otherwise cross.
- **The hook segment carries no wildcard**, for the reason D19 gives about
  action wildcards. "Every hook" is five claims, not one character.

A manifest does not restate these: they are **derived** from its declared
`hooks` at the widest scope, `hooks:*/*/*:<hook>`, and a grant may narrow the
scope because a narrower claim is covered by a wider request. What a grant may
not be is *absent* — a declared hook that no granted claim delivers anywhere
refuses the start, naming the line to add. That is D30's rule about absent
declarations applied here: nothing has been said, so nothing may be assumed.

### 13.7 Providers, and the built-ins

`SqliteStore`, `FsStore`, `FsBlobStorage` and `S3BlobStorage` register through
the same registry under **reserved names** (`sqlite`, `fs`, `s3`) that no plugin
may shadow, while staying compiled into the binary. `[storage] driver` and
`[blob_storage] driver` become registry lookups.

**`Searcher` is a port but not a provider kind**, though D30 makes it one of the
three. Two reasons, and the second is the real one. Nothing selects a searcher
by name — `[search]` has no `driver` key, and `Cli` derives the engine from the
store's own type — so the value would name a capability with no path behind it,
which is the speculative interface D7 rejects. And an external engine could not
stay correct if it were selected: D30 keeps the FTS index *inside*
`SqliteStore`, maintained by triggers in the same transactions as
`put`/`delete`/`deleteProject`, for exactly the reason D23 gives about media
usages — nothing above the port can be atomic with a bulk delete. A plugin is
outside that transaction by construction, so it could only be fed by
`entry.afterWrite`, which is best-effort and at-most-once (§13.5). An index that
drifts silently makes content unfindable and reports nothing, so the honest
prerequisite is the change feed (§12.1) rather than a config key. Until then a
third-party search backend is §12.8 work, and the enum stays two values — adding
one back is additive, removing one after 1.0 freezes the manifest would not be.

This is the trick D12 used for `_keys` and D18 for `Scope.System`: one code
path rather than two. Default installs are unchanged and need no network, and
the mechanism ships already carrying its most demanding consumers — which is
the D7 test, met before any third party sees it.

A third-party `Storage` is credible only if it is testable. The contract is
`apps/server/test/conformance/`, which pins invariants the
types cannot carry — `derived` landing inside the write transaction (D23, D30),
instance-global monotonic `seq`, D20's two-halves existence rule,
`listEntryCollections` differing from `listSchemas` on purpose. Publishing it as
`@silo/conformance` is §12.8 work; the ports freeze at 1.0 either way.

### 13.8 Configuration and CLI

```toml
[[plugins]]
name       = "@acme/silo-plugin-slugs"
claims     = ["collections:*/*/*:entries:read"]
timeout_ms = 5000            # per dispatch
on_error   = "fail"          # "fail" (default) | "skip"

  [plugins.config]
  field = "title"
```

```
silo plugin list                 configured plugins and their state
silo plugin info <name>          manifest, requested claims, config schema
silo plugin doctor               load everything, report failures, exit
```

All three are read-only and need no network, and they stay that way.

**`silo add` is the installer, and it landed after 1.0 (D32).** 1.0 shipped "a
plugin is a directory you place and list" because a package manager — registry
resolution, integrity pinning, a lockfile, a signature policy — is the largest
and riskiest piece of this design and none of it touches the contract. That
reasoning held: the installer is additive, and the two requirements this
section stated of whatever arrived are met — **no lifecycle script is ever run**,
and every extracted path component goes through `EntryUtils.assertSafeSegment`.

```
silo add <spec>                  install a plugin and list it in silo.toml
```

`<spec>` is one of five: a directory (`./my-plugin`), a tarball
(`./plugin.tgz`), an npm name and range (`silo-plugin-slug@^1`), an https
tarball URL, or a git repository. Each resolves to exactly one package —
there is no dependency graph, because §13.3 gives a plugin zero runtime
dependencies; a package declaring them anyway is installed with a warning.

What can be verified differs by source, and is reported rather than flattened:

| Source | Checked against |
| :--- | :--- |
| npm | the registry's `dist.integrity` (or legacy `shasum`), before unpacking — **and** `--integrity` when given, both of which must match |
| https URL | `--integrity sha512-…` if given; otherwise TLS alone, and it says so |
| local tarball | `--integrity` when given; a digest is computed regardless, so the *next* install is checked |
| directory | nothing is transferred — `--integrity` is **refused**, not ignored |
| git | nothing — pinned by resolved commit; `--integrity` is **refused** |

`--integrity` is honoured by every source that has bytes to hash and refused by
the two that do not. Accepting a security flag and silently dropping it is the
worst available handling: the operator types the argument that means "check
this", the install proceeds unchecked, and nothing in the output distinguishes
that from a verified one. On the npm path the operator's pin is not redundant —
the registry supplies both the tarball and the digest it is checked against, so
an independently known digest is the one thing a compromised registry cannot
satisfy. The two are joined into a single SRI string, since `Integrity.verify`
already requires every digest it is handed to match.

Nothing is written until every static check passes: the archive is validated in
full — paths, entry types and mode bits — before a byte lands, the manifest is
validated without executing the package (§13.2), the `silo` range is checked
against this binary, and a provider is refused a reserved driver name. The
package stages inside the plugins directory so the final move is a rename, and a
failure after it rolls back — a half-installed plugin is the outcome this most
wants to avoid.

Two rules the implementation had to learn rather than state. A violation found
while walking an archive is **recorded and thrown after the walk**, never thrown
out of tar's entry callback, which escapes into the stream and settles it
neither way — the archive most needing refusal would otherwise hang the command
refusing it. And a supplied digest is validated on **presence, not truthiness**,
once, before anything is fetched: `--integrity ""` used to be falsy at the
rejection, falsy again at the comparison, and `!== undefined` at the point of
deciding whether to warn, so an empty digest disabled the check *and* suppressed
the warning saying so. A truthiness test standing in for a presence test is how
a security check turns itself off.

`<data dir>/plugins/silo-plugins.lock.json` records what was installed, where it
came from, and what it was verified as. It is **a record, not a resolver**:
nothing reads it at startup, `serve` loads exactly what `silo.toml` names, and
deleting it breaks nothing. A lockfile that gated loading would be a second
source of truth beside the config file, which D31 made the whole management
surface.

The `[[plugins]]` block is then **appended** to `silo.toml` as text, never
re-serialised — `silo init` writes a file that is mostly comments on purpose,
and a TOML round trip would delete all of them. Appending also puts a new
plugin last in dispatch order, which is the only defensible default. The claims
the manifest requests are shown and confirmed first, because §13.6's whole
distinction is that a manifest *requests* and an operator *grants*: `--claims`
overrides the grant, `--yes` skips the question, `--no-register` skips the write
and prints the block instead, and a non-interactive stdin is a **no** — `silo
add` in CI fails naming `--yes` rather than granting what nobody was watching.

Signing is still deferred, and the honest limit is unchanged from D31: a digest
proves the bytes are the ones that were published and says nothing about who
published them. Installing is the trust boundary. There is no `remove` — a
plugin is unlisted by deleting its `[[plugins]]` block, which is a thing an
operator can already see how to undo.

**Authoring is a separate tool, and deliberately not a subcommand.**
`create-silo-plugin` — `npm create silo-plugin` — writes the manifest, a
runnable stub per hook, and the `silo:api` declarations. It is a standalone npm
package in `create-silo-plugin/`, not `silo plugin new`, because the person
scaffolding a plugin is a developer who may not have a silo binary installed at
all, while the binary is a root-owned file on a server; making authorship depend
on the runtime would be exactly backwards. It also adds nothing to what 1.0
freezes — it emits files, reads no config and touches no contract — which is
what keeps it outside the scope this section is protecting.

Two properties are load-bearing. It has **no runtime dependencies**, the same
property it gives the plugins it emits, so `npx` runs it against a silo it was
never installed beside. And every fact it copies from silo — the five hooks, the
reserved driver names, the two provider ports, the port method lists, the
`silo:api` `.d.ts` — is asserted against the original in silo's own suite
(`apps/server/test/plugins/create-silo-plugin-drift.test.ts`), so a sixth hook fails
the change that adds it rather than a stranger's scaffold months later. The
`"silo"` range it writes is derived from its own version, which `set-version`
moves with silo's: `^0.2` today, `^1` at 1.0, with nothing to remember. A
hard-coded `"^1"` would be right about the spec and wrong about every build
before it, and this gate does not degrade — it refuses the start.

**`silo import` never installs a plugin.** Archives carry data, not code. The
archive does not record plugin provenance either — it buys a warning message
and costs a `format_version` decision (D14).

### 13.9 Failure, timeouts, reentrancy

- A `ValidationError` or `ForbiddenError` from a hook is a **deliberate
  rejection** and propagates as 400/403; `SiloServer.onError` already maps both.
- Any other throw is a **plugin fault**, governed by `on_error` — `fail`
  (default, matching silo's fail-loud instinct) or `skip`, logged either way.
- Every dispatch is bounded by `timeout_ms`. This matters because `Service`
  serialises writes on a process-local `AsyncMutex`, which is exactly what makes
  optimistic concurrency sound without CAS in the adapters (D25, §6.1) — a hook
  blocking there blocks *all* writes instance-wide. Hooks run outside the mutex
  wherever possible, and the `Worker` is what makes the timeout enforceable at
  all — nothing preempts JavaScript in-process, so a synchronous spin would
  simply ignore a budget. That is why there is exactly **one** extension host: a
  second one where `timeout_ms` was advisory would be a trap wearing the same
  interface, so the inline host written during M5 was removed rather than left
  unselected (D7).
- Reentrancy is settled by the causal chain (§13.5, D33), not by a counter on
  the context. A `ctx` write appends the writing plugin to the chain, and
  `HookBus` will not dispatch back into a plugin already in it, so a cycle
  cannot form. `MaxDepth` still refuses a chain of more than four *distinct*
  plugins — refused, not truncated, because a silently un-run hook is the
  failure this design exists to avoid.
- **A plugin's dispatches are not serialised, and must not be.** They were,
  so that a single mutable `depth` on the context could describe "the dispatch
  currently being served" — and that lock deadlocked the case it protected. A
  hook calling `ctx.entries.create` re-entered `EntryService`, which dispatched
  `afterWrite` back into the same runtime, which blocked on the lock its own
  caller still held while awaiting the worker. It ended only at `timeout_ms`,
  and because there is no auto-restart the worker was then dead for the life of
  the process: **the first `ctx` write from a hook was also the last.** The fix
  is correlation rather than exclusion — the worker tags each callback with the
  dispatch id it came from, and `WorkerHost` looks the chain up in its own
  record of that dispatch. The chain is read host-side and never taken from the
  message, because a plugin that could name its own causal chain could hand
  itself an empty one and escape both the cycle skip and the depth bound.

### 13.10 Measured, not assumed

Every load-bearing mechanism was verified against a `bun build --compile`
binary — the only case that matters, since `bun run` is not how silo ships.
Measured on Bun 1.3.14, win32 x64:

| | |
| :--- | :--- |
| `await import()` of an external `.ts`, non-literal specifier | Works — the transpiler ships inside the binary, so plugins need no build step |
| Plugin resolving its own `node_modules` | Works |
| Host injecting a virtual module into the plugin's graph | Works, **with shared object identity** |
| External plugin inside a `Worker` | Works, ~20 ms cold start per worker |
| `while(true){}` plugin in a `Worker` | Host stayed responsive, timed out, terminated |
| Hook dispatch, inline | ~1 µs |
| Hook dispatch, `Worker` round trip | ~15 µs small, ~19 µs with a 2 KB document |
| `import.meta.dir` in a compiled binary | Points at the read-only embedded VFS — every plugin path comes from config, never from `import.meta.dir` (cf. `UiAssets`) |

19 µs against a SQLite write, an `ajv` pass and an HTTP round trip is noise.
That is why isolation is the default rather than an expensive opt-in.

**Re-verified on Bun 1.4.0 (2026-08-24), which is what the Dockerfile and the
release workflow now pin.** The mechanisms, not the numbers: `apps/server/test/plugins/`
passes end to end, which exercises the external `.ts` import, the virtual
module's shared identity, the worker round trip and the `while(true)`
timeout-and-terminate — and, against a `bun build --compile` binary rather than
`bun run`, a plugin scaffolded by `create-silo-plugin` and placed under a data
dir loads through `silo plugin doctor`. The timings stand as first measured and
were not re-taken.

One platform dependency is worth recording, because surfacing exactly this kind
of thing is what this section is for. `WorkerHost` boots from a `data:` URL of
roughly 4 KB, and **Bun 1.3.13 on macOS rejected any `data:` worker source over
about 1 KB with `NameTooLong`** — a 30-byte worker started, so the failure was
the *size*, and every extension plugin refused to load while providers were
unaffected. 1.4.0 accepts it. The lesson is not the bug: it is that the
bootstrap's size is load-bearing, so a host that grows one is a host to
re-measure.

**A second entry for the same reason (2026-08-25).** The per-plugin dispatch
lock deadlocked every `ctx` write made from a hook, and the suite did not say
so — it passed. What said so was the clock: the `mirror` test took **5.53 s**
against `timeout_ms: 5000` and **1.56 s** against `timeout_ms: 1200`, tracking
the budget exactly, which is what a dispatch that only ever ends by timing out
looks like. The functional damage was invisible for a different reason —
`EntryService` writes to the store *before* dispatching `afterWrite`, so the
entry the assertion looked for had already landed, and `WorkerHost` had killed
the worker with no restart by the time a second write arrived. Three entries
produced **one** mirror. Both regressions are now pinned by the same test: the
count *and* the elapsed time, because either alone would have passed.

The lesson generalises past this bug. A test whose only symptom is its duration
is a test that is not asserting the thing it is named for, and a suite that is
allowed to take seconds per case cannot tell a slow path from a timed-out one.
Where a plugin dispatch is involved, assert the clock.

## 13.11 Where this is going (D34–D36)

> **Designed, not built.** D33 has landed, phase 1 of D34 with it (§13.12), and
> phase 3's gate is cleared (§13.13). The rest is phased below. This section is
> the shape, not the specification — the decisions log carries the reasoning,
> and each phase writes its own detail here as it lands.

### The two holes this closes

Neither is a missing feature; both are the shipped model not meaning what it
says.

1. **Hook delivery is not claim-checked.** `HookBus` dispatches to any runtime
   that declared the hook, so a plugin granted *nothing* can see and rewrite
   every entry write in the instance. The claim system governs `ctx` and not the
   strictly more powerful capability beside it.
2. **A grant may exceed the manifest.** `PluginLoader.assertGranted` requires
   `requested ⊆ granted` and never the converse. Fine while a human types TOML;
   wrong the moment a UI shows "this plugin requested X".

### The shape

```
silo add <spec>          →  inert bytes under <data dir>/plugins/<name>/
                            nothing runs, no key exists

silo.toml [[plugins]]    →  which plugins load, and in what order
                            (a loading concern: the operator's file)

_system/_plugins         →  what each is allowed to do
                            (runtime authority: revocable, audited, API-driven)
      └── managed _keys record, secret host-side, rotated on restart
                     │
                     ▼
              plugin Worker
                     │
                 ctx.fetch  ── in-memory app.fetch ── AuthMiddleware / RouteAuth
                                                              │
                                                        SiloService

[storage] driver         →  a provider's grant, because it loads before the
                            store exists and cannot be granted from inside it
```

The split in the middle is the load-bearing part. **If grants lived in config,
revoking would need a restart; if registration lived in the database, whoever
could write the database could execute code.**

### Phases

| Phase | Lands |
| :--- | :--- |
| 0 | **D33, done.** The causal chain, and the deadlock it fixes |
| 1 | `_plugins`, managed keys, `hooks:` claims, `plugins:*` claims, `pending` state, offline `silo plugin grant`. **Reserve `/api/ext/`.** |
| 2 | Management API and audit log |
| 3 | `ctx.fetch` and the generated client. Its gate, the route-authority audit, is **done** — §13.13 |
| 4 | Supervisor: live enable, disable, reorder, revoke |
| 5 | Admin UI, inert `silo add`, `create-silo-plugin`, drift tests |
| 6 | Plugin routes under `/api/ext/{name}/*` |

### The acceptance test

Install a package; confirm it executes nothing and holds no key. Approve a
narrow schema/collection/entry grant; activate it; verify exactly those
operations work through `ctx` and the neighbouring ones are refused. Revoke it
live, and prove **both** `ctx` calls and hook delivery stop without a restart.

### What is still not claimed

Unchanged from D31, and worth restating because this design makes it easier to
forget: a `Worker` bounds **faults, not malice**. These permissions govern
silo's own APIs and the events the host chooses to deliver. Plugin code holds
full Bun privileges and can read the database or open a socket regardless, so
installing remains the trust boundary. A real hostile-plugin promise needs WASI
or an OS-isolated runner, and providers are trusted by construction — a
`Storage` implementation sees every byte by definition.

## 13.12 Grants, and the managed key (D34, phase 1)

> **Built.** The rest of D34–D36 — the management API, `ctx` as the HTTP
> surface, contributions replacing kinds, plugin routes — is still §13.11. D37
> (§13.13) later widened the forbidden claim set this section describes.

### Two places an operator can grant, and why

**Registration** stays in `silo.toml`: which plugins load, and in what order.
**Authorization** lives in a reserved `_plugins` collection in `Scope.System` —
the trick D12 used for `_keys` and D23 for `_media`, so it gets every adapter,
export and query for free.

The split is load-bearing in both directions. *If grants lived in config,
revoking would need a restart. If registration lived in the store, whoever could
write the store could execute code.*

`[[plugins]] claims` therefore survives as a **declarative** grant, and
effective authority is the **union** of the two, each bounded by what the
manifest requested:

```
effective = silo.toml claims  ∪  _plugins granted     both ⊆ requested
```

Two paths because they serve genuinely different deployments: a container built
from a config map cannot use an interactive grant, and an operator on a box does
not want to hand-edit TOML to withdraw one. `silo plugin revoke` clears only the
stored half and **says so** when config claims remain — the one place the union
rule could otherwise mislead.

### The four invariants

| | |
| :--- | :--- |
| `granted ⊆ requested` | The check `assertGranted` never had — it enforced only the converse, so a config could grant past the manifest. Harmless while a human typed TOML; wrong the moment a surface shows "this plugin requested X" beside a grant that exceeds it. |
| `granted ⊆ the granter's own authority` | `Claims.canDelegate`, unchanged from key minting. |
| **An upgrade never escalates** | A package that asks for more moves the record to `needs_review` and keeps running on the grant it had. The new claims are simply not in it. |
| A plugin never holds an escalation primitive, or root | `plugins:grant\|enable\|configure` widen the grant record; `keys:create\|revoke\|import` make it irrelevant (D37/§13.13). It runs code, so either way the grant would stop meaning what it says. |

`needs_review` is detected by a **digest of the request** — the claims and the
hooks, sorted — and the digest is deliberately **not advanced** while a review
is outstanding, or a second start would settle it silently and the plugin would
look approved for a request nobody read.

### The managed key

Approving mints a key into `_keys` with `owner: { kind: "plugin", name }`,
carrying exactly the granted claims. It is a real API key: a plugin is an API
key with code attached, and now it has one.

Its secret stays **host-side**. Not because a malicious plugin would gain
anything by holding it — full Bun privileges mean it can read the database
regardless (§13.4) — but because the common failure is *accidental*: a plugin
logging its token, or shipping it to a telemetry endpoint. Custody removes that
for nothing.

Three consequences, each of which is a place the ordinary key path had to learn
about managed keys:

- `silo keys revoke` **refuses** one, naming `silo plugin revoke` instead. Silo
  re-mints it, so revoking by hand looks like it worked and undoes itself.
- A managed key **does not count** toward bootstrapping. An instance whose only
  keys were managed would have no way in at all, and would have reported itself
  as already bootstrapped — the worst version of that.
- A managed key is **left out of every archive**, including `--with-keys`. It is
  not a credential anybody holds, so carrying it would put a record in the
  destination that no `_plugins` grant points at, that the ordinary revoke path
  refuses to remove, and that nothing can ever authenticate as.

### Pending is a state, not a failure

An installed, listed, ungranted plugin **loads**, is delivered nothing, and has
every `ctx` call refused. It does **not** refuse the start, and that is a narrow,
argued exception to §13.3: approving needs a running server to approve through,
so a server that refused to boot could never be given one.

It needs no code path of its own, which is the part worth keeping. *Pending is
an empty claim list*, and every check already refuses that — `HookBus` will not
deliver, `PluginContext` will not act. What pending adds is **noise**: a warning
on every start, a `[pending]` marker in `silo plugin list`, and a non-zero exit
from `silo plugin doctor`, because a plugin that runs and quietly does nothing
is exactly what §13.3 refuses to let pass unremarked.

```
silo plugin grant <name> [--claims a,b]   approve; no --claims means all requested
silo plugin revoke <name>                 withdraw the stored grant
```

Both are **offline, against the data directory** — bounded by filesystem access,
the same authority `silo keys create` already has here. That is what makes them
more than a convenience: they are the way out of the boot deadlock, and the way
to provision a plugin in CI.

`/api/ext/` is reserved here too, though nothing mounts under it until phase 6.
D31 reserved `/api/plugins/` for plugin routes and D34 took it back, because
management needs that space and the two cannot share it: once
`POST /api/plugins/acme/grant` is a verb, a plugin route named `grant` is
unroutable. Reserving costs nothing now and is unavailable later, so it happens
in the change that defines the management surface rather than the one that
finally uses it.

## 13.13 The route-authority audit (D37)

> **Done, and it changed the shipped API.** Phase 3 was gated on this because
> `ctx` becomes an in-process dispatch of the routes below: at that point every
> route guard is a plugin guard, and a route that asks for less authority than
> it exercises is a way for a granted plugin to do more than it was granted.

### Why this had to come before `ctx`, not after

D34 made a plugin a principal, but a principal is only as bounded as the surface
it acts through. Today `PluginContext` is five hand-written entry methods with a
claim check each — narrow enough to audit by reading. Phase 3 replaces that with
thirty routes, and inherits every authority decision they already make. **Any
route whose guard names less than the route does becomes an escalation the grant
model cannot see**, because the grant would be honest and the route would not.

So the question this audit asks is not "is this route safe" but: *if a plugin
held exactly the claim this route checks, and nothing else, what could it do?*

### Findings

Each was reproduced against a live instance before being written down, and each
is now an assertion in `apps/server/test/http/route-authority.test.ts`.

| # | Finding | Status |
| :--- | :--- | :--- |
| F1 | `?force=true` destroys entries under a collection-lifecycle claim | **Fixed** |
| F2 | `keys:revoke` names no target, so the narrowest key holding it revokes root | **Fixed** |
| F3 | A plugin granted `keys:*` escapes its own grant | **Fixed** |
| F4 | A minted key outlives the principal that minted it | Deferred — phase 2 |
| F5 | `--no-auth` would hand every plugin root through `ctx` | Phase 3 precondition |
| F6 | Bulk erasure dispatches no hooks | Deferred — phase 6 |
| F7 | `/api/copy` fetches an operator-supplied URL | Accepted, see below |

**F1 — force is a second operation, not a modifier.** `DELETE
.../collections/{name}/schema?force=true` required `collection:delete` and
nothing else, and erased every entry in the collection. `DELETE
/api/projects/{p}?force=true` did the same across every environment. Measured: a
key holding one claim over one collection deleted three entries and returned
204; a key holding `collections:default/*/*:delete` emptied the instance.

Without `force` these routes refuse while content exists, so `collection:delete`
alone is an honest ask — the caller is removing a definition that holds nothing.
With it, the same request is a bulk `entries:delete` wearing a
collection-lifecycle claim, dispatching no hooks and asking for no revision.
`force` now additionally requires `entries:delete` at the reach it destroys: the
collection for a collection delete, `{project}/{env}/*` for an environment,
`{project}/*/*` for a project. This is the rule `replace` mode already applies to
transfer and to scope copy (`TransferPermissions.Replace`); forced deletion was
the third place the same thing was true and the only one where the guard was
missing.

The pair lives on `Claims` as `ForcedDeletePermissions` rather than at the three
route guards, so the admin UI gates its delete buttons on exactly what the routes
enforce. Moving the UI onto it surfaced a second, older mismatch: the environment
and project pages asked `hasAnyCollectionPermission` — *delete on some collection
in this scope* — to authorize deleting every collection in it, while the hint text
beside the disabled button already named the scope-wide claim the route actually
wanted. The message had been right and the check wrong.

**F2 — revoking was unbounded while minting was not.** `POST /api/keys` has
always checked `Claims.canDelegate`: you cannot mint a key more powerful than
your own. `DELETE /api/keys/{id}` checked `keys:revoke` and stopped. Measured: a
key holding *only* `keys:revoke` revoked the root key, after which the root
secret returned 401 and the instance had no administrative credential at all.

That is not privilege escalation — it is worse in the way that matters
operationally, because it is unrecoverable without filesystem access. Revocation
is now bounded by the same predicate minting is: **if you could not mint a key
this powerful, you may not destroy one.** A key still revokes itself, since a
claim list always covers itself, and root still revokes anything.

**F3 — three claims let a plugin walk around its own grant.** `keys:import` is
the sharpest: an import writes `_keys` rows verbatim, with no schema validation
because system collections skip it, so an archive can carry a key record whose
hash the author chose and whose claims are `*`. Measured: a planted record
authenticated as root on the next request. `keys:create` mints an **unmanaged**
key — a credential with no `owner`, which `silo plugin revoke` therefore does not
withdraw. `keys:revoke` destroys other principals' credentials.

None of these widen the grant *record*, which is why D34's original forbidden set
missed them: they make the record irrelevant instead. All three joined
`PluginForbiddenClaims`. `keys:read` and `keys:export` deliberately did not —
they disclose the authority map rather than change it, and disclosure is a
trade-off an operator can weigh.

**F4 — descendant keys.** With `keys:create` now forbidden to plugins this is not
reachable *through* a plugin, but it remains true of ordinary keys: a minted key
has no link to its minter and survives its revocation. The fix is the `parent_id`
and cascade the original D34 analysis called for, and it belongs with the
management API in phase 2 rather than here, because that is where key lifecycle
gets its audit trail.

**F5 — `--no-auth` is a phase 3 precondition, not a bug today.** `AuthMiddleware`
sets `claims: ["*"]` for every request when auth is disabled. That is correct for
what it means now. It stops being correct the moment `ctx` dispatches through the
same middleware: every plugin on every development instance would silently hold
root — precisely where plugins are written and tested, so the grant model would
be untested exactly where it is most exercised.

The mechanism was verified to work: `app.request(path, init, env)` delivers a
principal on `c.env`, a real network request carries `undefined` there, and no
request header can forge it. **Phase 3's middleware must read the injected
principal before the `authDisabled` branch, not after.**

**F6 — bulk erasure is invisible to hooks.** `CollectionEraser` calls
`store.delete` directly, so a forced collection or project delete fires no
`entry.afterDelete` at all. Measured: a create dispatched, the force-delete that
removed it did not. Auditing and mirroring plugins therefore see entries appear
and never see them go.

Left alone deliberately. Dispatching one event per erased entry would make a
100k-row delete a 100k-event fan-out through the D33 chain, and the honest fix is
a collection-level hook rather than a flood of entry-level ones. That is a
`contributes` question, so it belongs to D36 and phase 6.

**F7 — `/api/copy` is a server-side fetch to an operator-supplied URL**, with an
operator-supplied bearer token. That is what the route is for, and its guard is
right: `transfer:copy`, instance-wide write, and `media:create`. It is not a new
capability for a plugin, which holds `fetch` inside its Worker regardless — so
`transfer:*` stays grantable. Noted because it is the one route that reaches
outside the instance, and any future network policy has to start here.

### What the audit confirmed was already right

The value of an audit is as much what it pins as what it changes, and these are
the properties phase 3 *rests on* — so they are asserted rather than assumed.

- **The system scope is unaddressable over HTTP.** `Scope.of` refuses a
  `_`-prefixed id, so no collection claim — `*` included — reaches `_keys`,
  `_media` or `_plugins`. This is the single boundary that makes "a plugin is an
  API key with code attached" safe to say.
- **Hook dispatch happens outside the write lock.** All four dispatch sites in
  `EntryService` sit outside `withWriteLock`, so a hook that writes back through
  the HTTP surface acquires a free lock rather than waiting on the one its own
  caller holds. `AsyncMutex` is not reentrant, so this is exactly D33's deadlock
  waiting to return if a dispatch ever moves inside the lock — measured green,
  and now pinned by a test that fails on the clock rather than on a count.
- **Instance-wide operations already ask for instance-wide authority.** Export,
  import, copy and reindex each require the collection permissions they exercise
  at `*/*/*` on top of their fixed claim, which is what stops a project-confined
  key from reading its way out through an archive (D21/D24).
- **Scope-to-scope copy asks for no `transfer:*` claim** and is right not to: it
  reaches no scope the caller could not already reach one entry at a time (D22).
- **Media usage listings are filtered per-claim**, so a refused delete reports
  how widely a file is used without naming scopes the caller cannot see (§8.1).

### What phase 3 must do

1. Read the injected principal **before** the `authDisabled` branch (F5).
2. Confine `ctx` to `/api/`. The SPA fallback and `/media/{id}` sit outside the
   auth middleware entirely; a plugin has no business in either.
3. Carry the causal chain across the dispatch, so a plugin's HTTP-shaped write
   still refuses to re-enter its own hooks. D33's guarantee currently lives in
   `PluginContext`, which phase 3 replaces.
4. Give a dispatch its own timeout budget. `WorkerHost` kills a worker
   permanently on timeout with no restart, and `ctx.fetch` makes a slow hook far
   more likely than five in-process method calls did — so phase 4's supervisor
   stops being optional once phase 3 lands.
