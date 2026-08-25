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
routes, and a plugin's own `ctx` calls, which since D35 *are* those routes
(§13.15), reached in-process rather than over a socket. The transfer paths
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

> **Since D35 that last sentence is the implementation, not the analogy.** A
> `ctx` call is a request against the same Hono app a network request hits,
> carrying a principal built from the grant, so the check below is
> `AuthMiddleware` and `RouteAuth` rather than anything this section describes
> separately. §13.15 has it; what follows is the claim vocabulary, which is
> unchanged.

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

> **Partly built.** D33 has landed, phase 1 of D34 with it (§13.12), phase 2 has
> shipped (§13.14), phase 3 has followed its cleared gate (§13.13) into §13.15,
> phase 4 is §13.16 — so the acceptance test below now passes, and is a test
> rather than a plan — and phase 5 is §13.17. Phase 6 remains. This section is
> the shape, not the specification — the decisions log carries the reasoning, and
> each phase writes its own detail here as it lands.

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
| 2 | **Done, §13.14.** Management API, the `_audit` trail, descendant keys |
| 3 | **Done, §13.15.** `ctx.fetch`, the generated client, and the four requirements §13.13 left it |
| 4 | **Done, §13.16.** Supervisor: live enable, disable, reorder, revoke, reconfigure, rescan |
| 5 | **Done, §13.17.** Admin UI — the grant screen, lifecycle and the trail. (`silo add`, `create-silo-plugin` and the drift tests landed early, with D32) |
| 6 | Plugin routes under `/api/ext/{name}/*` |

### The acceptance test

Install a package; confirm it executes nothing and holds no key. Approve a
narrow schema/collection/entry grant; activate it; verify exactly those
operations work through `ctx` and the neighbouring ones are refused. Revoke it
live, and prove **both** `ctx` calls and hook delivery stop without a restart.

**It passes, and it is a file:**
`apps/server/test/plugins/plugin-supervisor.test.ts`. The last sentence is the
one that needed care — a test asserting only "the plugin stopped doing
anything" would pass just as happily against the half-fix §13.15 refused to
ship. So the two halves are proved separately: narrowing the grant to the hook
claim alone leaves the plugin *still delivered* and *no longer able to read*,
and only then does the revocation stop delivery too.

### What is still not claimed

Unchanged from D31, and worth restating because this design makes it easier to
forget: a `Worker` bounds **faults, not malice**. These permissions govern
silo's own APIs and the events the host chooses to deliver. Plugin code holds
full Bun privileges and can read the database or open a socket regardless, so
installing remains the trust boundary. A real hostile-plugin promise needs WASI
or an OS-isolated runner, and providers are trusted by construction — a
`Storage` implementation sees every byte by definition.

## 13.12 Grants, and the managed key (D34, phase 1)

> **Built.** The rest of D34–D36 — `ctx` as the HTTP surface, contributions
> replacing kinds, plugin routes — is still §13.11. D37 (§13.13) later widened
> the forbidden claim set this section describes, and D38 (§13.14) put the
> management API in front of everything here.

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

## 13.14 The management API and the trail (D38, phase 2)

> **Built.** Phase 4 (§13.16) later made `enable`, `disable` and the grant take
> effect immediately, replaced `restart_required` with a `runtime` block, and
> shipped the two verbs cut below. The admin UI is §13.17; plugin routes
> (phase 6) remain.

### What it manages, and what it does not

Everything under `/api/plugins/` reads and writes the **`_plugins` record**.
Nothing reaches the filesystem, which is D34's registration/authorization split
holding one layer up: the store says what a plugin may do, and `silo.toml` still
says what loads and in what order. An API that could add a `[[plugins]]` block
would be a code-execution primitive wearing a management claim.

```
GET    /api/plugins                  plugins:read
GET    /api/plugins/{name}           plugins:read     → ETag: "<rev>"
PUT    /api/plugins/{name}/grant     plugins:grant    If-Match required
DELETE /api/plugins/{name}/grant     plugins:grant    If-Match required
POST   /api/plugins/{name}/enable    plugins:enable   If-Match required
POST   /api/plugins/{name}/disable   plugins:enable   If-Match required
GET    /api/audit                    audit:read
```

Two verbs from the original sketch were **not** here, and both were cut for the
same reason: `POST /api/plugins/rescan` and `PATCH /api/plugins/{name}/config`
each need to read a manifest from disk, and each only *takes effect* once phase
4 can reload without a restart. Shipping them then would have been an API whose
whole answer is "restart to find out". They landed with the supervisor, in
§13.16, along with `POST /api/plugins/{name}/restart` — which the same argument
had kept out without anyone naming it.

`PUT` and not `POST` on the grant, because the body is the **complete** granted
set: sending it twice grants the same thing, and narrowing is expressible
without first revoking. An omitted body means everything requested, which is the
default `silo plugin grant` already takes, for the same reason — granting in
full is the common case, so narrowing is what takes an argument.

### `If-Match` is not ceremony

On a grant it is the mechanism: **approving means approving what you read.**
Without the fence, a package whose request changed between the operator reading
it and approving it would be approved on the strength of the older one — the
exact substitution `needs_review` exists to catch, arriving through the API
instead of through an upgrade.

That made the ordering inside `grant` load-bearing, and the first version got it
wrong. Three orderings are possible and only one is safe at every step:

| Order | What breaks |
| :--- | :--- |
| discard → mint → write | A refused write leaves the record pointing at a key that no longer exists, plus an orphan. **This shipped, briefly, and a smoke test caught it.** |
| write → rotate | The previous, possibly *wider* key stays live after the record says it was narrowed. |
| **mint → write → discard** | Nothing. A refused write throws the new key away and leaves the old one alone. |

`revoke` checks the revision **before** discarding the key, for the same reason:
a stale `If-Match` must not destroy a credential on its way to a 409.

And **reconciling writes nothing when nothing changed**. Reconcile runs for every
plugin at every start, so an unconditional write bumped every revision on every
restart, invalidating every `If-Match` an operator held for a change nobody could
point at. Measured on a running instance: four restarts walked one plugin from
rev 1 to rev 7.

### Enable is not revoke

`enabled` is orthogonal to the grant, and deliberately so. A disabled plugin
keeps its claims and its managed key; pausing something is not the same decision
as un-approving it, and an operator who had to re-approve after every pause would
learn to approve widely to avoid the trouble. It is guarded by `plugins:enable`
rather than `plugins:grant` for the same reason.

Until phase 4 it took effect at the next start, and **every surface said so**:
the response carried `restart_required: true`, `PluginLoader` logged a warning
when it skipped one, `silo plugin list` showed `[granted, disabled]`, and `silo
plugin doctor` reported it and exited non-zero. A management call that silently
does nothing until someone happens to restart is §13.3's least favourite
outcome, and the only defence against it was saying so at every surface an
operator might look at.

Since §13.16 it takes effect **now**, and `restart_required` is gone rather than
set to `false` — a flag that is always false is noise. What replaced it is
`runtime`, which answers a question the record never could: `enabled` and
`state` are what an operator *decided*, and a granted, enabled plugin whose
worker died on a dispatch timeout is still not running. The other four surfaces
stayed exactly as they were; they were right about the facts, and only wrong
about the remedy.

### The trail

`_audit` is a fourth reserved system collection, after `_keys` (D12), `_media`
(D23) and `_plugins` (D34) — so it gets every adapter and query for free, and is
excluded from archives and from the entries API by rules that already existed.
Only **authority** changes go in it: `key.create`, `key.revoke`, `plugin.grant`,
`plugin.revoke`, `plugin.enable`, `plugin.disable`. Entry writes are not audited
— that is what `rev`, `updated_at` and the hook stream already are, and
duplicating content history here would turn a log about decisions into a log
about traffic, which is what makes an audit log too big to read.

Three properties are worth stating because each was a choice:

- **The services append, not the routes.** So `silo keys create` and `silo
  plugin grant` land in the trail too. A log that only saw the API would say a
  key appeared from nowhere, which is the question it exists to answer.
- **An append that fails is logged, not rethrown.** The `Storage` port has no
  cross-collection transaction, so the choice is between a change that might go
  unlogged and a caller told its change failed when it succeeded. The second is
  worse — it invites a retry against state that has already moved — so the
  failure goes to `error` level and the operation stands.
- **Retention is unbounded, on purpose.** An authority log grows with
  *decisions*, not with traffic. An instance that grants a plugin twice a year
  has a two-line history, and pruning would only ever discard the oldest
  evidence.
- **Event ids are monotonic ULIDs**, unlike every other id in silo. Plain
  `ulid()` re-randomises its suffix per call, so two events in the same
  millisecond sort either way — and `at` ties there too, leaving "newest
  first" undefined for exactly the burst a trail most often records: a grant
  and the key rotation it causes. A flaky test found it. The factory is local
  to the trail, because entry ids have no ordering requirement and a shared
  monotonic generator would make every collection pay for a property only this
  one reads.
- **Every managed key that disappears says why.** `keys.create` appends before
  a grant's write is attempted, so a refused write would otherwise leave a
  creation with no matching removal. The rollback, the rotation and the
  withdrawal each record a `key.revoke` carrying a `reason`.

`audit:read` is a new fixed claim, carried by `manage` and `root`. There is no
`audit:write`: nothing updates or deletes an event, so a claim guarding that
capability would imply one that does not exist.

### Descendant keys (D37's F4, closed)

`POST /api/keys` now records `parent_id`, and revoking a key revokes everything
descended from it, transitively. D37 measured the gap: a minted key is bounded by
its minter's authority at the moment of minting and by **nothing afterwards**, so
without the link, revocation is a suggestion — anyone about to lose a key mints a
spare first.

Not a `?cascade=true` flag. Putting the correct behaviour behind an argument
nobody passes is the same as not having it. The response stays 204 and the list
of what went is in the trail, which is the surface built to answer "what happened
to those other keys"; `silo keys revoke` prints them, and `KeyView` exposes
`parent_id` so a caller can see what a revocation would take before asking for
one.

The walk carries a visited set. A parent must exist before its child, so a cycle
cannot arise from ordinary use — but `_keys` is an ordinary collection that an
import or a hand edit can write, and a walk that looped forever on a malformed
record would turn a bad row into a hung revocation.

## 13.15 `ctx` is the HTTP API (D35, phase 3)

> **Built.** The supervisor landed in §13.16 and closed the debt this section
> ends on. The admin UI is §13.17 and plugin routes (phase 6) remain, and D36's
> `contributes`, `activate()` and `required`/`optional` permissions are still
> §13.11.

### What changed

`PluginContext` held five entry methods with a hand-rolled claim check each. It
now holds **one** callable method, `fetch`, and a call is a request against the
same Hono app a network request hits — so `AuthMiddleware` and `RouteAuth` decide
what a plugin may do, unchanged and unaware that the caller is a plugin.

```
plugin worker
    │   ctx.entries.list(scope, "posts")      generated client
    │   ctx.fetch("/api/…")                   the primitive underneath
    ▼
PluginContext.fetch          builds the principal from the grant
    ▼
PluginApiDispatcher          confines to /api/, applies the call's deadline
    ▼
app.request(url, init, env)  env carries a module-private symbol
    ▼
AuthMiddleware               reads the injected principal FIRST
RouteAuth                    the guard a key meets, unchanged
    ▼
SiloService
```

The alternative was widening `call` from five methods to roughly forty, and it
fails on the repo's own stated fear: it would have re-implemented
`requirePublicOrClaim`, the transfer permission lists and the media-usage
disclosure rule as **a second evaluator that can disagree with the first** —
exactly what `@silo/shared/claims` exists as one facade to prevent. Reusing the
routes instead means the surface grows for free: a route added in 1.x is a plugin
capability with no plugin work, and every guard already written keeps applying.

### The principal is attached, never presented

Identity travels on `app.request`'s `env` argument under a **module-private
symbol** — `InjectedPrincipals`, whose two methods are the only way to write or
read the slot. Nothing arriving over a socket can reach it: `env` is the
runtime's bindings object, and no header, query parameter or body shape becomes
a symbol-keyed property.

That unforgeability is what lets the middleware trust the slot *more* than a
bearer token, which is why **`ctx.fetch` drops `Authorization` and `X-Api-Key`
outright.** A worker never receives its own secret, so a plugin holding a
credential it found elsewhere still cannot present it: **the channel is the
credential.**

The claims on that principal are the **resolved** grant — `silo.toml` union the
`_plugins` record (D34) — rather than the managed key's own `granted` list,
because an operator may grant through either and the union is what every check
before this phase used. The key record is the revocable handle and the name in
the trail; the grant is the authority.

### The four requirements §13.13 left

**1. Read the injected principal before the `authDisabled` branch (F5).** Done,
and it is the whole of the finding: `--no-auth` gives every request `["*"]`,
which is right for what it means and becomes wrong the instant `ctx` dispatches
through the same middleware. Every plugin on every development instance would
have silently held root — precisely where plugins are written and tested, so the
grant model would be untested exactly where it is most exercised. Pinned by a
test that asserts *both* halves on one instance: an anonymous request still gets
200, and the plugin beside it still gets 403.

**2. Confine `ctx` to `/api/`.** The path is resolved against a fictional origin
and the result must still be that origin with an `/api/` prefix. One check
catches three shapes: `..` is normalised away *before* the prefix is tested,
`//example.com/api/x` — a path that is really an authority — lands on another
origin, and an absolute URL never had a chance. The two surfaces outside `/api/`
are the SPA fallback and `/media/{id}`, and both sit outside the auth middleware
entirely, so a plugin reaching them would be reaching *unauthenticated* routes
carrying a principal nothing reads. `/media/{id}` is the one that matters: it
serves bytes to anyone holding an id, which is a media grant nobody made.

**3. Carry the causal chain across the dispatch.** D33's guarantee lived in
`PluginContext`, which this phase replaced, so the chain rides the same injected
slot as the principal — one slot, because they are one fact: *who is asking, and
what caused them to ask.* Write routes read it back through a single
`RouteAuth.getWriteContext`. The sharp test is a plugin that writes into the
collection it hooks: with the chain, one write and one echo; without it, an
immediate loop that only `HookBus.MaxDepth` would stop.

**4. Give a dispatch its own timeout budget.** A `ctx.fetch` is bounded by **what
is left of its dispatch's budget**, minus a small margin, rather than by a
constant. The margin is the point: bounded by exactly the remaining budget, the
call loses the race to `WorkerHost`'s dispatch timer every time, and the worker
is killed for the dispatch running long instead of the plugin being told which
call did it. Until phase 4 that kill is permanent and silent, so the difference
is between a plugin that can catch a slow route and a plugin that never runs
again. A call made *outside* any dispatch — a timer, or a future `activate()` —
gets the full `timeout_ms`, because it has no deadline over it and would
otherwise have had none at all.

Both facts come from the host's record of the dispatch and never from the
worker's message, for the same reason: a plugin that could name its own chain
could hand itself an empty one, and a plugin that could name its own deadline
could hand itself an unbounded one.

### One contract, two emitters

The plugin-facing surface used to be mirrored **by hand in three places** — the
host's method switch, the worker bootstrap that called it, and the `silo:api`
declarations that typed it — with nothing but review keeping them in step.
`PluginApiContract` is now the one description, and two emitters read it:

| Emitter | Produces | Drift |
| :--- | :--- | :--- |
| `PluginClientSource` | the worker's client, spliced into the bootstrap **at start** | impossible — there is no second copy |
| `PluginTypesSource` | the `SiloContext` members in `silo-api-types.d.ts` | pinned by a test, because `tsc` reads files |

The contract is a **convenience, not a boundary**. Every method is a path
`ctx.fetch` could reach spelled out by hand, so nothing there grants anything and
leaving a route out denies nothing — which is what makes the list a matter of
taste rather than of security, and why it covers what a plugin reaches for often
instead of all thirty routes.

Its field names are the HTTP API's own, wart for wart: entries and search page
under `data`, media and collections under `items`. Smoothing that over would cost
the property this design is *for* — the same client running against a remote silo
over a real socket — for a cosmetic gain the API itself can make later, once, for
everybody.

The split between the primitive and the client is deliberate and testable:
`ctx.fetch` reports a refusal as a **status**, and the generated methods turn one
into a **throw**. A plugin asking whether something exists should not need a
`try`/`catch` to hear the answer, and a plugin reading an entry it was granted
should not have to check a status code.

### What a dispatched request is not

**It has no origin, so it writes no media URLs.** A route expands
`silo://media/<id>` into `<base>/media/<id>` using the request's `Host` header —
the header naming where a client reached this instance. A dispatched request
never crossed a socket, so the only host in it is the fictional one paths are
resolved against, and rewriting a reference to `http://plugin.silo.internal/…`
is worse than not rewriting it: a plugin that stores or forwards that value has
persisted a dead link, and one comparing it to the stored reference finds no
match. `RequestUtils.getBaseUrl` returns `""` for a dispatched request, which
leaves the reference exactly as stored — what `ctx` handed plugins before this
phase, and the only honest answer to "where is this instance reachable" when
nothing asked over the network.

**It is not anonymous in the log.** An access log now contains lines no client
sent, so a dispatched request carries `plugin=<name>`. Without it an operator
reading one sees traffic from nobody.

### What phase 4 had to fix (§13.16 did)

Revoking a grant destroyed the managed key immediately and the running plugin
kept acting on the claims it loaded with — measured live: after
`DELETE /api/plugins/smoke/grant`, `_keys` no longer held the record and the next
`ctx.fetch` still succeeded. That was not a regression, because the resolved grant
was always held in memory, but it was the gap between "a plugin is an API key with
code attached" and the implementation, and precisely what §13.11's
acceptance test names: revoke live, and prove **both** `ctx` calls and hook
delivery stop without a restart. Doing half of it here would have been worse than
none — a plugin whose `ctx` is dead while its hooks still fire is a new
inconsistent state, and hook delivery is read from the same in-memory grant.

That "same in-memory grant" is what made the fix small: two *copies* of it were
the bug, and one cell with two readers is §13.16.

## 13.16 The supervisor (D39, phase 4)

> **Built.** The admin UI followed in §13.17; plugin routes (phase 6) remain.

### One cell, two readers

The whole of live revocation is that a `ResolvedGrant` stopped being copied.

It used to be captured twice at load: once on `PluginRuntime`, where `HookBus`
reads it to decide whether an event may cross into a worker, and once inside
`PluginContext`, where it becomes the injected principal. Both were `readonly`,
which is why revoking needed a restart — and why fixing only one of them would
have produced the state §13.15 named and refused. `PluginAuthority` is a box
holding one `ResolvedGrant`; both readers hold the box; `set` is the whole
operation. Nothing is torn down, because nothing should be: **a plugin is an API
key with code attached, and changing what a key may do has never meant
restarting whoever holds it.**

The discipline the cell demands is small and absolute: read it at the decision
point, never into a local at construction. That is the only way the sentence
above stays true, and it is why `PluginRuntime.authority` is a getter rather than
a field.

### The ordering rule

Everything else in phase 4 is process lifecycle, and every lifecycle verb has two
steps — one that changes the running set and one that writes the record. Which
goes first is not a matter of taste, and it does not point the same way twice.
One rule settles all of them:

> **The record must never describe a state the next `serve` cannot reach.**

| Verb | Order | What the other order breaks |
| :--- | :--- | :--- |
| `enable` | **start → write** | `PluginLoader` refuses the *whole start* for a plugin it cannot load. A record saying `enabled: true` for a broken package therefore turns one failed API call into a server that will not boot. Undoing the start is stopping, which cannot fail. |
| `disable` | **write → stop** | Stopping first and then losing the write to a stale `If-Match` leaves a stopped plugin whose restoration is a *restart* — and a restart can fail. |
| `config` | **restart → write** | Same as `enable`: a record holding a config its plugin cannot start with is an unbootable instance. If the write is then refused the previous config is put back, and if that fails the plugin reports `failed` while the record still names the config that worked. |
| `grant` / `revoke` | **write → swap** | The swap cannot fail, so it goes second and a refused write changes nothing. |

D38 found the same shape one level in, where only mint → write → discard is safe
at every step inside `grant`. It is the same question each time — *if the second
step fails, can the first be undone, and what does the record claim in the
meantime?*

Every operation runs under one mutex. Not for the store, which has its own write
lock, but because these compose: an `enable` and a `rescan` that interleaved
would both decide what the ordered set is, and one would win by accident.

### What the API gained

```
PATCH  /api/plugins/{name}/config    plugins:configure   If-Match required
DELETE /api/plugins/{name}/config    plugins:configure   If-Match required
POST   /api/plugins/{name}/restart   plugins:enable      no If-Match
POST   /api/plugins/rescan           plugins:enable      no If-Match
```

`restart` and `rescan` are unfenced because neither writes a record: there is no
revision anybody could be approving, and requiring one would be the ceremony
§13.14 says `If-Match` is not.

Every view also gained a `runtime` block — `running | stopped | failed`, with a
sentence saying why when it is not running — and `config` beside
`config_source`. `restart_required` is gone.

### Config: an override, not a union

`plugins:configure` was defined in D34 and used by nothing until now, which is
the claim `PATCH .../config` wanted.

Claims **union** the two grant paths because claims are a set and a union is
still a set, bounded by `requested`. Two config *documents* have no such join. A
merge would leave `required` and `additionalProperties` judged against a value
neither source wrote, and would make "what config is this plugin running with" a
computation rather than something to read. So the stored override **replaces**
`silo.toml`'s block whole, and `DELETE .../config` is the way back — the config
analogue of `silo plugin revoke` clearing only the stored half, and like it,
every surface says which source is in force.

The patch itself is [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396) JSON
Merge Patch: changing one setting without restating the block, and removing one
with `null`, are exactly what it defines, and inventing a shape would be a
proprietary field language in the one project that advertises having none. What
is *stored* is the result rather than the patch, so the record holds a document
somebody can read.

One consequence found while wiring it, and worth stating because it is the sort
of thing that would have shipped quietly: because the restart happens *before*
the write, the record at that moment still holds the previous override — so a
worker started from `PluginGrantUtils.configFor(record, …)` comes up on the
config the operator just replaced. The effective document is therefore passed
into `PluginLoader.start` rather than derived inside it, and validated there
against the manifest, which also closes a gap the boot path had: a stored
override was reaching a worker without ever meeting the schema.

### Rescan, and why it does not breach D34's split

`POST /api/plugins/rescan` re-reads `silo.toml` and makes the running set match
it: plugins added, removed, reordered, upgraded in place, or reconfigured in the
file. It is also how a grant made offline — `silo plugin grant` against a data
directory a server is already serving — reaches that server.

It is the one verb here that touches the filesystem, and it touches it to read
the **operator's own file**. That is the distinction D34 drew: an API that could
*write* a `[[plugins]]` block would be a code-execution primitive wearing a
management claim, while one that applies a block the operator already wrote runs
exactly what a restart would have, sooner. Guarded by `plugins:enable`, because
rescan is enable and disable applied to the whole set and "may this caller decide
whether plugin code runs" should have one answer rather than two.

Three properties, each a choice:

- **A plugin nothing changed is left alone.** Restarting everything is what a
  naive reload does; it also discards in-flight dispatches and any state a
  plugin built up, on every rescan, for plugins the operator never touched.
  "Changed" means what the worker was *started with* — the module, the declared
  hooks, the config document, the dispatch bounds — and deliberately not the
  grant, which is swapped in place.
- **A failing plugin is reported, not thrown.** A `serve` that refuses leaves
  the operator where they were; a rescan that refused would abandon every other
  change in the file to a plugin they may not have touched. The failure is in
  the report, that plugin is left not running, and the next `serve` still
  refuses to start — which the report says. It makes rescan `doctor` that takes
  effect.
- **A broken file changes nothing at all,** and says why. The re-read happens
  first, and a config that does not parse is not a set of plugins. The parse
  error is re-thrown as a refusal so it reaches the caller *whole*:
  `ConfigLoader` throws a plain `Error`, which the HTTP layer renders as
  `internal error` with no detail — the least useful thing to say to somebody
  who has just mistyped a `[[plugins]]` block, since the message they need is
  the one being discarded. **Found on a running instance, not by the suite**,
  which is the second phase running where that has been true.
- **Providers are skipped, and say so.** A provider *is* the storage; swapping
  it would mean swapping an open database underneath every in-flight write.

### A dead worker is no longer silent

`WorkerHost` tears a worker down on a dispatch timeout or a crash and does not
respawn it — a plugin that missed its budget is usually still spinning, so an
automatic restart walks into the same wall while hiding that anything happened
(§13.9). That reasoning survives phase 4 intact. What did not survive is the
*silence*: until now nothing reported it, so the plugin simply stopped working
while every surface still showed it as loaded.

`runtime.state` is `failed` with the reason, and `POST .../restart` is the
deliberate act that brings one back. Not automatic, and not a retry — an operator
restarts having read why it died.

A start that *fails* needed a shape too, and this is the first phase where one
was required: before it, every start happened at boot, where a plain `Error`
refusing the whole process is right and the operator reads it on stderr. Through
the API that same error renders as `internal error`, discarding the sentence
that says what to fix — *declares `entry.afterWrite` but exports no such
function*. `PluginStartError` carries the loader's own words out as
`plugin_start_failed`, a 500 with a `remedy`, in the shape
`MediaDeleteStalledError` already uses for the other failure that is neither a
refusal nor a bug.

### What phase 4 does not do

- **It does not write `silo.toml`.** Registration stays the operator's file, and
  that is the load-bearing half of D34's split.
- **It does not hot-swap a provider.** Storage is opened before plugins load and
  a driver change is a restart.
- **It does not watch the filesystem.** A rescan is asked for. A server that
  reloaded on its own would make "what is running" depend on an editor's save
  timing, and would turn a half-written config file into an outage.
- **It does not make a `Worker` a security boundary.** Unchanged from D31 and
  worth restating in the phase that makes plugins easier to start and stop:
  installing is still the trust boundary.

## 13.17 The grant screen (D40, phase 5)

> **Built.** Plugin routes under `/api/ext/{name}/*` (phase 6) remain.

Phase 4 is what makes a UI worth building. Before the supervisor every button
here would have ended in *"restart the server to find out"*, which is not a
management surface — it is a form for editing a file badly.

`/servers/{id}/settings/plugins` lists what has a record; each plugin's page
holds its grant, its configuration and its trail. Nothing new is decided at the
list level: it answers the question an operator opens it with — *is anything
waiting on me, is anything broken* — and every write happens one level down.

### Hook delivery has to lead

D34 made hook delivery a claim because a plugin handed `entry.beforeValidate`
over a collection rewrites everything written to it, which no `entries:*`
permission grants. A grant screen that listed the two as peers would undo that
in presentation: the shorter-looking string is the larger authority.

So hook groups come first in every summary, an intervening hook is flagged where
it is ticked, and the claims are described by **what they let the plugin do**
rather than by the event name — "rewrite entries before they are validated", not
`entry.beforeValidate`. `HookNames.Intervening` existed from D34 for this and had
no caller until now.

Building it found that the summary did not render hook claims **at all**. The
builder asked whether a claim parsed as a collection permission or as a known
fixed one, and a hook claim is neither, so it fell through both branches and out.
Measured: `hooks:blog/prod/posts:entry.beforeValidate` and
`hooks:*/*/*:entry.afterWrite` beside one `entries:read`, summarised in full as
*"read entries"*. The fix is not the missing branch — it is the question. The old
guard asked "is this an unrecognised **fixed** claim", which catches the next
fixed claim and nothing else; it now asks *was this claim rendered by anything*,
which is the only form that survives a new claim **kind**.

### Two things the view was not saying

Both were shipped D38 behaviour, both surfaced only because a screen had to
render them, and both would have made the grant screen lie.

**A grant written in `silo.toml` was invisible.** D34 made effective authority
the union of the file and the record, and `/api/plugins` reported the record.
Measured on a running instance: a plugin answering `ctx.fetch` with `200` was
reported `state: "pending"`, `granted: []`, and everything it asked for still to
approve. The startup log had it right the whole time, because it goes through
`PluginGrantResolver`; the API did not, because it read `record.state` directly.
The view now carries `config_claims` and `effective` beside `granted`, and takes
its `state` from the resolver — one function, as `stateFor` already says it
should be.

**What the manifest declares was not there either.** `kind` decides whether the
lifecycle affordances mean anything — a provider *is* the storage, runs
in-process, has no worker to restart — and `config_schema` is what the settings
form is generated from. D31 put that schema in the manifest and said why:
carried at 1.0 "even though nothing renders it, which is what lets the admin
settings form arrive later through RJSF with no manifest change". This is that
later. `PluginInspector` reads the package once per plugin and answers both,
preferring a running plugin's own copy and falling back to disk — which is what
lets a *disabled* plugin still show its config form.

### Narrowing, and the answer that is not yes or no

A manifest asks wide (`collections:*/*/*:entries:read`) and an operator grants
narrow. `PluginGrantPlan.narrow` rewrites only the segments the plugin left as
`*`: rewriting one it named would not be narrowing, it would point the plugin
somewhere it never asked to go.

That makes "does the plugin hold this request" a three-valued question, and
getting it wrong was visible immediately. With a boolean, a narrowed grant reads
as **not granted** — so after successfully approving `mirror` at `default/prod`,
the screen redrew with every box clear and the summary reading *"Nothing. It
stays loaded and receives no events."* about a plugin that was, at that moment,
mirroring. `granted | narrowed | none` fixes the form, the count in the listing,
and one thing neither: the scope selects are now **read back off what is
granted**, because otherwise saving an unchanged form would silently widen it.

The server's `not_granted` is left alone. It is an exact set difference and it is
true — the plugin does not hold `collections:*/*/*:entries:read` — and the UI
computes its own count from `requested` against `effective`. Two true statements;
only one of them answers *"is there a decision outstanding here"*.

### What a live pass caught that the suite did not

The third phase running where that sentence is true, and worth keeping a tally
of. Along with the two above, driving the finished screen against a real
instance found the activity trail rendering **nothing** for the action it exists
for: it read `detail.claims`, which is what `key.create` writes, while
`plugin.grant` writes `granted` and `plugin.revoke` writes `withdrawn`. One
field name across seven actions, and the one that mattered was not it.

### What phase 5 does not do

- **It does not install plugins.** `silo add` writes to the data directory and
  `silo.toml` names what loads; an API — and therefore a UI — that could do
  either would be a code-execution primitive wearing a management claim.
- **It does not edit `silo.toml`.** The config form writes an *override*, and
  says so; "Use silo.toml" clears it.
- **It does not gate its own nav item.** Consistent with API Keys and Data
  Transfer, the page loads and reports what the key may not read, rather than
  the nav quietly having fewer entries on some keys than others.
