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

> **Superseded (D34–D36), and all of it has landed.** The two-kind table above
> is now a `contributes` list (§13.19), authorization has moved from
> `[[plugins]] claims` into a granted `_plugins` record with a managed API key
> (§13.12), hook *delivery* is claim-gated, `ctx` is the HTTP API dispatched
> in-process (§13.15), the running set changes without a restart (§13.16), and
> plugin routes live under a reserved `/api/ext/{name}/*` so `/api/plugins/*` can
> be the management surface (§13.18). §13.11 has the shape and the phase list;
> the decisions carry the reasoning. Sections 13.2–13.10 describe D31 as it
> shipped, and each says where a later phase changed it.

### 13.2 The manifest is static

Static metadata lives in `package.json#silo` and **must be readable without
executing the plugin** — `silo plugin info` has to show an operator what a
package wants before any of its code runs.

```jsonc
{
  "name": "@acme/silo-plugin-slugs",
  "silo": {
    "silo": "^1",                    // SiloVersion range; checked at startup
    "contributes": { "hooks": ["entry.beforeValidate"] },
    "permissions": {
      "required": [
        { "claim": "collections:*/*/*:entries:read", "reason": "To read the entry it slugs." }
      ]
    },
    "config": { "type": "object", "properties": { "field": { "type": "string" } } }
  }
}
```

- `contributes` is everything the package adds — any of `hooks`, `routes`,
  `runtime` and `providers`, none of them exclusive. It replaced a `kind` that
  could only ever pick one; see §13.19 for what that cost.
- `permissions` splits what it asks for into `required` and `optional`, each
  entry carrying the author's `reason`. **The default grant is `required`**, and
  a blank reason refuses the start.
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

Six. The five entry hooks each carry `op` rather than doubling the set, and the
sixth is collection-level, added by D36 to close D37's F6 — a forced delete
erases every entry under a collection and dispatches no `entry.afterDelete` at
all, so an auditing plugin saw entries appear and never saw them go. See §13.19
for why it is one event rather than one per row, and why there is no `before`
counterpart.

| Hook | Kind | May |
| :--- | :--- | :--- |
| `entry.beforeValidate` | **mutating** | replace `data`, reject |
| `entry.beforeWrite` | **veto-only** | reject |
| `entry.afterWrite` | observe | nothing |
| `entry.beforeDelete` | veto-only | reject |
| `entry.afterDelete` | observe | nothing |
| `collection.afterDelete` | observe | nothing |

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

**`collection.afterDelete` dispatches outside the write lock too**, and getting
that right is the whole of its implementation: `CollectionEraser` runs *inside*
the lock, so it returns a count instead of dispatching, and the caller — which
owns the lock and knows when it released it — raises the event after. See §13.19.

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
scope because a narrower claim is covered by a wider request. Since D36 the same
is true of `http:route`, derived from declared routes (§13.19). What a grant may
not be is *absent* — a declared hook that no granted claim delivers anywhere
refuses the start, naming the line to add. That is D30's rule about absent
declarations applied here: nothing has been said, so nothing may be assumed.

### 13.7 Providers, and the built-ins

`SqliteStore`, `FsStore`, `FsBlobStorage` and `S3BlobStorage` register through
the same registry under **reserved names** (`sqlite`, `fs`, `s3`) that no plugin
may shadow, while staying compiled into the binary. `[storage] driver` and
`[blob_storage] driver` become registry lookups.

**A provider is a contribution, not a kind of package** (D36). One package may
register several drivers and may register hooks beside them, and each provider
names **its own entry module** — it is imported into the host process before
storage is opened, while the rest of the package runs in a `Worker` afterwards,
so sharing one module means importing the worker half at the one moment when
there is no store for it to reach. See §13.19.

**`Searcher` is a port but not a provider port**, though D30 makes it one of the
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
third-party search backend is §12.8 work, and `ProviderPort` stays two values —
adding one back is additive, removing one after 1.0 freezes the manifest would
not be.

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

**`[plugins.config]` is validated, not completed.** `PluginConfigValidator`
compiles the manifest's schema with Ajv and checks the operator's table against
it; it does not run with `useDefaults`, and nothing downstream fills one in
either — `PluginGrantUtils.configFor` picks the stored override *or* the file's
block, whole. So a `"default"` in a config schema is a fact for the settings form
and for `silo plugin info`, and a key nobody wrote arrives at `ctx.config` as
`undefined`.

That is the honest behaviour for a document somebody edits — the config in force
is one table a person wrote, not a computation over two — but it means **a plugin
states its own defaults in code**, and a fallback that disagrees with the manifest
is a silent misconfiguration. The Strapi importer found this the expensive way:
its manifest advertised `media_folder: "strapi"` while the code read a missing key
as the library root, so every import filed several hundred hashed filenames
somewhere the operator had been told they would not be. Its `PluginSettings` is
the shape to copy — one class, every default named once, and a test asserting each
against what the manifest declares.

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
- **Both of those stop at the commit.** `HookNames.Terminal` —
  `entry.afterWrite`, `entry.afterDelete` — asks whether the hook is terminal
  *before* it asks what class the error was, because after the write has landed
  there is nothing left to reject and a refusal is as meaningless as a fault.
  Asked the other way round, a post-commit `ForbiddenError` surfaced as a **403
  on a request that had already succeeded**, naming a claim the *plugin*
  lacked to a caller who never needed it — and never reached the logger, so
  the operator saw nothing while the client saw the wrong thing. Both halves
  are now the same line: dropped, and logged as `outcome=dropped`.
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

> **Built.** D33 has landed, phase 1 of D34 with it (§13.12), phase 2 has
> shipped (§13.14), phase 3 has followed its cleared gate (§13.13) into §13.15,
> phase 4 is §13.16 — so the acceptance test below now passes, and is a test
> rather than a plan — phase 5 is §13.17, and phase 6 is §13.18. The rest of D36
> — `contributes` replacing `kind`, `activate()`/`deactivate()`, and
> `required`/`optional` permissions carrying `reason` strings — is **§13.19**,
> which also closes D37's F6. **Nothing here is outstanding.** This section is
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
| 6 | **Done, §13.18.** Plugin routes under `/api/ext/{name}/*`, gated by `http:route` |
| — | **Done, §13.19.** `contributes` replaces `kind`, `activate`/`deactivate`, `required`/`optional` permissions with reasons, and D37's F6 |

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

`/api/ext/` is reserved here too. Nothing mounted under it until phase 6, which
is §13.18.
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
| F6 | Bulk erasure dispatches no hooks | **Fixed** — §13.19 |
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
a collection-level hook rather than a flood of entry-level ones.

**Closed by `collection.afterDelete` (§13.19).** It stayed open across six phases
because it is a `contributes` question — a new name in the hook *vocabulary*,
reaching `HookNames`, the claim grammar, the manifest, the `.d.ts` and the grant
screen's words — and phase 6 deliberately took only the narrow piece of
`contributes` that routes forced. One event per collection carries the count and
a `cause` of `collection`, `environment` or `project`. It dispatches **outside
the write lock**, which is the property this section pins two entries below and
the reason `CollectionEraser` returns a count instead of raising the event where
the deletes happen. There is no `before` counterpart, on purpose: a veto would be
a plugin overruling an explicit `?force=true` from a caller who already had to
hold `entries:delete` at the reach being erased — F1's own fix — and a project
delete erases many collections under one lock, so a refusal halfway through would
leave the project half-erased.

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
> ends on. The admin UI is §13.17 and plugin routes are §13.18 — which is also
> where the `/api/` confinement below turns out to matter twice, since
> `/api/ext/` is inside it. D36's `contributes`, `activate()` and
> `required`/`optional` permissions are still §13.11.

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

> **Built.** Plugin routes followed in §13.18, and the route list is rendered
> beside the grant there for the reason this section gives about hook delivery.

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

A **fourth** turned up in the verification pass over the finished phases, and it
is the oldest bug either phase has surfaced: a post-commit hook's refusal
reaching the caller as a 403 on a write that succeeded (§13.9). It dates from
D31 and needed nothing newer to exist — but nothing newer made it *ordinary*
either. Reaching it used to mean hand-editing a partial grant into `silo.toml`
and restarting; phase 5 offers it as the second checkbox on the grant screen and
phase 4 applies it with no restart, so the thing to notice is not that a live
pass found an old bug. It is that **shipping a UI for an operation changes how
often that operation's edge cases are reached**, and the suite had covered the
rejection path and the fault path without ever crossing either with `Terminal`.

### What phase 5 does not do

- **It does not install plugins.** `silo add` writes to the data directory and
  `silo.toml` names what loads; an API — and therefore a UI — that could do
  either would be a code-execution primitive wearing a management claim.
- **It does not edit `silo.toml`.** The config form writes an *override*, and
  says so; "Use silo.toml" clears it.
- **It does not gate its own nav item.** Consistent with API Keys and Data
  Transfer, the page loads and reports what the key may not read, rather than
  the nav quietly having fewer entries on some keys than others.

## 13.18 Plugin routes (D36, phase 6)

> **Built.** The rest of D36 — `contributes` replacing `kind`, `activate()`, and
> `required`/`optional` permissions with `reason` strings — is still §13.11.

A plugin declares routes in its manifest and serves them under
`/api/ext/{name}/*`. That is the whole feature; everything interesting is about
two questions, and one of them is not the one it looks like.

### Reaching a route is reaching the plugin's grant

A handler receives the same `ctx` a hook does, so it reads and writes with **the
plugin's** authority and never the caller's. That is not an implementation
detail to be tightened later — it is what a plugin route *is*. A plugin exists
to do something the caller cannot, and a handler bounded by the caller's claims
could only ever do what the caller could have done directly.

The consequence is the classic confused deputy, and it is the reason for the
shape of everything else here:

- **`http:route` is a claim**, so exposing a plugin at all is a decision an
  operator makes rather than a property of the package. It is plugin-shaped like
  `hooks:…` — it authorises being *reached*, not reaching anything, so a key
  holding it gains nothing.
- **One claim, not one per route.** The routes are already enumerated in the
  manifest and mounted under the plugin's own name; a plugin cannot escape its
  prefix, so there is no reach for a scope to narrow. What carries the detail is
  the route list, which is why the grant screen renders it beside the claim
  rather than leaving a client to infer it.
- **`auth: "public"` is declared per route** and called out wherever the routes
  are shown. It is the one property of a route nobody can infer from the claim,
  and it is the sharp end of the deputy problem: a public route publishes
  whatever the plugin was granted at a URL anyone can reach.
- **A plugin never receives a credential.** `authorization`, `x-api-key` and
  `cookie` are withheld from the handler, and `caller` carries an id, a label and
  claims instead. The same rule as `PluginApiDispatcher` stripping those on the
  way *out*: a plugin acts as itself, so the only use for a caller's secret is to
  act as them, and a plugin that never holds one cannot log or forward one.
  Claims are included so a plugin can be *stricter* than its route's `auth`,
  which is the one thing it might legitimately want.

### Routes are data, not registrations

silo matches them itself. A plugin never touches Hono's router, and that is the
design rather than a shortcut.

`RouteManager` already documents that registration order is load-bearing for
Hono's matcher — `/schema` before `/:id`, `/search` before entries — so letting
third parties into that list is letting them break entry reads by accident. And a
plugin able to register `/api/ext/x/*` would claim every path its namespace will
ever have, including ones a later silo version gives a meaning.

Interpreting them instead buys three things at once. They cannot shadow a silo
route. They cannot reorder one. And they can appear and vanish while the process
runs — which is what makes **phase 4 apply to routes**: `ExtRoutes` looks the
plugin up through `PluginSupervisor` on every request, so enable, disable,
revoke, restart and rescan mean here exactly what they already mean for hooks. A
route table captured at boot would have made this the one surface the supervisor
did not reach.

The grammar is deliberately smaller than Hono's — literal segments and `:name`
parameters, no wildcards, no optionals, no regular expressions —  and
`ManifestReader` refuses the rest at the manifest, so the refusal names the
package rather than surfacing as a route that never matches. Paths are split
**before** they are decoded, because decoding first lets a `%2F` inside a
parameter become a separator and one segment match two.

### A route cannot become a loop

`ctx.fetch` is confined to `/api/`, and `/api/ext/` is inside it — so a plugin
can reach its own route, and a one-line handler that calls itself would
otherwise recurse until the fetch budget ran out.

The guard is not a new counter. It is the fact `HookBus.shouldDispatch` already
reads: a plugin in the event's causal chain is one whose own work caused this
request, and re-entering it is exactly what D33 made unrepresentable for hooks.
`ExtRoutes` refuses rather than skips, because a request has to answer something
and a 200 with no handler run would be a lie. Plugin-to-plugin calls are
untouched — only a cycle has its target already in the chain.

### What the answer looks like

A handler returns a value and never a status code. Nothing is a 204, a string is
`text/plain`, any other object is a JSON body, and `{ status, headers, body }` or
`{ json }` sets one explicitly. The normalising happens **inside the worker**,
because those forms only exist on that side of the clone boundary; the host only
ever sees `{ status, headers, body }`.

Refusals reuse the path that already exists. A handler throwing `ValidationError`
or `ForbiddenError` produces a 400 or a 403 through `SiloServer.onError`, rebuilt
by name across the worker boundary exactly as a hook's refusal is (§13.9) — so
there is one error mapping in the codebase and not a second one for routes. The
only failure `ExtRoutes` catches itself is the timeout, because it is the one
whose meaning is about the transport rather than the request: the plugin did not
answer, it is now `failed`, and the response says
`POST /api/plugins/{name}/restart`.

A body is bounded at 1 MiB and **refused** past it rather than truncated or
dropped, because a plugin cannot tell a body it was not given from one that was
never sent — a caller would get a 200 describing work done on the wrong input.

### One narrow piece of `contributes`, taken early

`ManifestReader` refused an extension that declared no hooks, on the grounds that
nothing would ever call it. With routes that sentence is simply false, and it is
D36's own complaint about `kind`: it made a package that wanted to serve a route
invent a hook merely to be loaded. The check now asks whether *anything* would
call the plugin — hooks or routes — which is the same question with the right
subject. The rest of the `contributes` restructure is untouched.

Declared routes with no `http:route` **refuse the start**, matching
`assertDeliverable` one capability over: a plugin whose every route answers 403 is
running, healthy, and not doing the thing it was installed for, and that failure
would otherwise surface to a caller rather than to whoever deployed it. A plugin
awaiting approval is exempt, for the boot-deadlock reason D34 gives.

### What a live pass caught, for the fifth phase running

Two, and both were about a plugin route being *unlike the rest of the instance*
rather than about plugins at all.

**`HEAD` on a declared `GET` route answered 405.** Measured against a running
instance: `HEAD /api/health`, `/api/projects` and `/api/plugins` all answer 200,
and `HEAD /api/ext/greeter/hello` did not. `HEAD` is `GET` without content (RFC
9110 §9.3.2), and the callers that send it are caches, proxies, link checkers and
uptime monitors — none of them anything a plugin author tests with. A declared
`GET` now answers it and `ExtRoutes` drops the body, so a handler never has to
know which of the two it is answering.

**`http:route` summarised as a raw string under "Also".** `ClaimWords` named it
and the per-claim lookup spoke it, but the grant summary's section list was
written by hand and no prefix matched `http:`. This is D40's bug at one lower
severity — that one *dropped* hook claims, this one merely failed to describe a
claim — and D40's fix does not cover it, because asking "was this claim rendered
by anything" guarantees a claim is **shown**, not that it is shown in words. The
families are now derived from the catalogue, and the new test asks whether a
claim is *spoken* rather than whether it is *known*, which is the distinction the
existing one could not see.

### What phase 6 does not do

- **It does not let a plugin serve outside `/api/ext/{name}`.** Not a
  restriction to relax later: the prefix is what makes "cannot shadow a silo
  route" a structural fact rather than a review item.
- **It does not add middleware.** A plugin cannot intercept another plugin's
  route or silo's own; §12.8 lists interceptors as a separate, additive idea and
  they would need their own authority story.
- **It does not stream.** A request and a response each cross the worker
  boundary as one value, so there is no back-pressure to be had and an unbounded
  body would be a way to make the host allocate whatever a caller sends. Media
  has its own route.
- **It does not make a `Worker` a security boundary.** Unchanged since D31, and
  worth restating in the phase that gives plugin code a URL: installing is the
  trust boundary.
- **It did not finish `contributes`.** It took the one narrow piece routes forced
  — the "declares nothing" check — and left `kind`, `activate()` and
  `required`/`optional` to §13.19, which is where they landed. §13.19 also made
  `http:route` **derived** from declared routes rather than written out by hand,
  so `assertServable` now catches a case an author can no longer create.

## 13.19 Contributions, and a reason for every claim (D36, completed)

> **Built.** This is the rest of D36 — the half phase 6 (§13.18) deliberately
> left — plus D37's **F6**, which was parked here because closing it needed the
> hook vocabulary to grow. §13.11 has nothing outstanding after it.

Two fields replace two, and the pair is what a grant screen is made of:
`contributes` is **what a package will do**, and `permissions` is **what it needs
in order to do it**.

```jsonc
"silo": {
  "silo": "^1",
  "contributes": {
    "hooks": ["entry.beforeValidate", "collection.afterDelete"],
    "routes": [{ "method": "GET", "path": "/health", "auth": "public" }],
    "runtime": true,
    "providers": [{ "port": "storage", "driver": "turso", "entry": "./storage.ts" }]
  },
  "permissions": {
    "required": [
      { "claim": "collections:*/*/*:entries:read", "reason": "To read the entry it slugs." }
    ],
    "optional": [
      { "claim": "media:read", "reason": "To count images in a post, when you allow it." }
    ]
  }
}
```

### A package is not one thing or the other

`kind` was an enum, so it had one value, and the two restrictions that followed
were arbitrary in both directions. It forced a package that only wanted a
background timer to **invent a hook merely to be called**. And it forbade a
storage provider from registering the hook that keeps its own derived data in
step — a plugin whose whole reason to exist is that the two belong together.

The halves run in different places, and that is a fact about *when* rather than
about what a package **is**: a provider is constructed in the host process before
storage is opened, because it *is* the storage, and hooks and routes run in a
`Worker` afterwards. So a provider names **its own entry module**. That is not
tidiness — sharing the package's main module means the host imports the worker
half at the one moment when there is no store for it to reach, and a provider
load failing that way produces an error nobody can read. It also lets one package
register two drivers, which the singular `provider` block could not express.

Everything downstream stops asking what a package is:

- `PluginLoader.loadProviders` walks `contributes.providers` rather than
  filtering by kind, and a package with none is skipped.
- `PluginLoader.prepare` asks `PluginContributionUtils.runsInWorker` — hooks, or
  routes, or a runtime. A package contributing only providers gets no worker and
  **no grant record**, which is the same rule stated positively: it loads before
  the store exists, so it could not be authorized from inside the store even if
  there were somewhere to say so.
- `PluginInspector` reports "it contributes only the blob driver *x*, so it runs
  in-process with no worker of its own" instead of choosing between "provider"
  and "stopped", and the admin listing labels a package by every contribution it
  has rather than by the one an enum happened to name.

**The retired keys refuse the start, by name.** `kind`, `hooks`, `routes`,
`provider` and `claims` at the top of the `silo` block each produce a refusal
naming what replaced them. Reading the old shape too was the alternative and is
worse in the way that matters: a `claims` array silently dropped is a plugin that
asks for nothing — it loads, looks healthy and cannot work — and a package could
then request a claim with no reason attached simply by using the older spelling.

### `activate` is capability without authority

A declared `runtime` means the module exports `activate(ctx)` and
`deactivate(ctx)`. It is what a plugin with no lifecycle event actually needs, and
it is **declared** rather than discovered for §13.2's reason: an operator reading
a manifest should see that this package runs code of its own accord, and a
function the manifest does not declare is never called.

It costs **no claim**, and the parallel with `http:route` is worth resisting
deliberately. A route is reachable by a stranger and runs with the plugin's
grant, which is the confused deputy — that is why exposing one is a decision.
Nobody calls `activate` but silo, it is told about nobody else's data, and its
`ctx` is the same claim-checked surface a hook's is. What it adds is *uncaused*
work, not new reach. A pending plugin is activated too, with every call refused —
exactly as its hooks go undelivered, and needing no code path of its own.

**Activation is a step after the app is attached.** Extensions load in
`SiloRuntime` so `SiloService` can be given their hook bus, and the Hono app is
built from that service afterwards — so at the moment a worker starts, the surface
a `ctx` call dispatches against does not exist yet. Starting a worker and letting
it *act* are therefore two different events and only the second has a
prerequisite: `serve` attaches, then activates, then binds. Activating before the
bind means a plugin that seeds or migrates something has finished before the first
request can observe half of it.

`PluginRegistry.activate` is idempotent, which is what lets there be two callers —
the boot pass, and `PluginLifecycle.spawn` for a plugin enabled on a running
instance — without either needing to know whether the other already ran.
`deactivate` runs on the way out and is **best-effort**, for the reason
`entry.afterWrite` is: the decision to stop has been taken, so there is nothing a
failure here could change. A plugin that hangs in it costs one `timeout_ms` and is
terminated regardless.

A declared runtime with no `activate` export refuses the start, exactly as a
declared hook with no export does, and for the same reason: from outside, a plugin
whose setup never ran looks identical to one whose setup succeeded.

### `required` and `optional`, and why the default had to change

A flat `claims` array could not say the one thing that decides a grant: whether
the plugin is broken without a permission, or merely does less. The distinction
has to exist somewhere, because **a default grant has to pick something** —
approving everything asked for makes `optional` meaningless, and approving nothing
makes every approval a chore that trains an operator to press *Select all*.

So the default grant is `required`, and an optional permission is opt-in. That is
the only reading under which the two words mean what they say, and it changes
three surfaces at once: `silo plugin grant <name>` with no `--claims`,
`PUT /api/plugins/{name}/grant` with no body, and the boxes a grant form opens
ticked. A package declaring nothing optional is unaffected by all three.

`required` is **stored in the record** beside `requested`, and that is D38's rule
rather than a convenience: the management API acts on the record and never on the
filesystem, so a default grant that had to read the package would be exactly the
coupling that rule exists to prevent. A record written before the split carries no
`required`, and `PluginGrantUtils.requiredOf` reads one as all-required — which is
what the whole request meant when there was no other kind.

It joins the **manifest digest**, and that is the case worth stating: promoting an
optional claim to required changes what "approve the default" would approve
without changing a single claim in the list, so a digest over the claims alone
would let a package widen a default grant silently at the next start. The `reason`
strings are deliberately **out** of it — they are what an operator reads while
deciding, so including them is tempting, but a package fixing a typo would then
move every instance to `needs_review` for a decision nobody changed, and
re-prompting for nothing is how a review prompt stops being read.

**A reason is required, and a blank one is refused.** That looks like ceremony
until you ask what a grant screen shows without it. An author who may omit it
will, and an empty line beside `collections:*/*/*:entries:delete` tells an
operator that nothing needs saying. Three things are now said about every row and
they are three different voices: the claim is the grammar, `ClaimWords.phrase` is
what silo says it means, and the reason is what the **author** says the plugin
wants it for. Only the last can answer "should I allow this".

**Derived claims get derived reasons.** A `hooks:` claim per declared hook, and
`http:route` when routes are declared, are computed rather than restated — D34's
argument about hooks, extended to routes, where phase 6 left the author to
remember `http:route` by hand and `assertServable` exists because they forget.
Both are `required`, and not by the author's say-so: a hook nothing delivers and a
route that answers 403 each refuse the start already, so calling them optional
would be calling a refusal optional. Each carries a sentence of silo's own, so no
row on a grant screen has nothing to say about itself.

A grant short of a required claim is **warned about, not refused**. Refusing would
refuse every pending plugin, since pending is an empty claim list, and the boot
deadlock D34 exists to avoid would be back. What the split fixes is the silence: a
plugin narrowed to two of five claims on purpose and one granted two by accident
used to look identical, and only the author's own list tells them apart.

### `collection.afterDelete` (D37's F6, closed)

The finding was measured five phases ago and left open deliberately:
`CollectionEraser` calls `store.delete` directly, so a forced collection,
environment or project delete removed every entry underneath it and dispatched
**nothing**. Auditing and mirroring plugins watched entries appear and never saw
them go.

One event per erased entry was the alternative and is worse: a 100k-row delete
would become a 100k-event fan-out through the D33 chain, for a fact that is one
sentence long. So the hook is **collection-level** — one event carrying the
collection, how many entries went with it, and `cause`, which is `collection`,
`environment` or `project`. A mirror cares about the last: `environment` and
`project` mean every sibling collection is going too, so the useful reaction is to
drop the scope rather than one table.

**Nothing about it is special-cased, and that is why it is one name rather than a
mechanism.** The claim grammar already reads
`hooks:<project>/<env>/<collection>:<hook>`, and the collection segment names the
erased collection, so delivery is checked by the same `Claims.canDeliver` every
other hook goes through. It is `Terminal`, so a refusal from it is dropped rather
than answered — the collection is gone by the time it fires, and phase 4's
ordering rule (terminal is asked *before* the error's class) already covers it.

**It dispatches outside the write lock, and that placement is the whole of the
implementation.** D37 pinned that every entry-hook dispatch site sits outside
`withWriteLock`, because a plugin that writes back through the HTTP surface has to
find a free lock rather than wait on the one its own caller holds — `AsyncMutex`
is not reentrant, so dispatching inside the lock is D33's deadlock returning. So
`CollectionEraser` does not dispatch at all: it **returns a count**, and the
caller, which owns the lock and knows when it released it, dispatches after.
`ScopeService` was already collecting a plan of every collection before touching
any of them — so that a project delete cannot be left half-erased — and the counts
ride out on that same plan.

There is deliberately no `collection.beforeDelete`. A veto there would be a plugin
overruling an explicit `?force=true` from a caller who already had to hold
`entries:delete` at the reach being erased (D37's F1), and a project delete erases
many collections under one lock — so a refusal halfway through would leave the
project half-erased, which is precisely what the up-front plan exists to prevent.

### What a live pass caught, for the sixth phase running

Three findings, and every one of them is a **report** rather than a behaviour.
That is why the suite missed all three: the plugin did the right thing in each
case and nobody was told.

**A failing `activate` named neither the plugin nor activation.** A hook's failure
has always been wrapped by `HookBus.run` as `plugin "x" failed in <hook>: …`;
activation had no equivalent, because until now there was nothing to activate. The
entire report on a running instance was `silo: collection "default/prod/mirrors"
not found` — a refused start, with nothing tying it to the package that caused it.

**A live narrowing below `required` was silent.** `PluginLoader.report` warns at
boot; `PluginLifecycle.reapply` did not. Phase 4 made narrowing something that
happens while the process runs and phase 5 made it a checkbox, so the operator who
narrows a grant was the one person who never saw the consequence. This is the same
shape as the phase-4/5 finding recorded in §13.9: shipping a UI for an operation
changes how often its edge cases are reached.

**`silo plugin list` and `silo plugin info` reported the record's raw state.** The
`_plugins` record only ever describes the *store* half of a grant, so a plugin
granted entirely through `silo.toml` sits at `pending` there forever — and the CLI
printed `[pending]` on the line directly above the `claims:` line listing what
that plugin was running on. D40 found and fixed exactly this in `/api/plugins`;
the fix was `PluginGrantResolver.state`, and the CLI was the other caller nobody
looked at. Worth recording as a pattern rather than a slip: when a defect is a
surface reading the wrong one of two sources, the question to ask next is which
*other* surfaces read the same thing.

### What D36 does not do

- **It does not make `contributes` open-ended.** Four kinds, closed. Adding a
  fifth is additive; a package announcing arbitrary contribution types would be
  registration magic, which §4 refuses.
- **It does not let `activate` outlive a request budget.** A `ctx` call from a
  timer a plugin started gets a fresh `timeout_ms` rather than an unbounded one,
  because `WorkerHost.serveRpc` gives an uncorrelated call the full budget by
  design — genuinely uncaused work has no deadline over it, so it gets one.
- **It does not schedule anything.** `activate` is a callback, not a cron: a
  plugin that wants a timer sets one. Durable scheduling needs the change feed
  (§12.1) and belongs with it.
- **It does not enforce a reason.** Nothing checks that a plugin uses a claim for
  the reason it gave. The reason is documentation on a decision, and treating it
  as a constraint would be promising an analysis silo does not perform.

## 13.20 Bytes, panels, and the first first-party plugin (D41)

> **Built.** §13.11 had nothing outstanding after §13.19, so this is not a phase —
> it is what writing a real plugin found. `plugins/silo-plugin-strapi-import` is
> silo's first first-party plugin, and three of the four things below exist
> because it could not be written without them.

### A plugin could not be handed a file

`ExtRequest` decoded every route body as UTF-8 and capped every route at one
global mebibyte. `ctx.media.get` is metadata only, and `/media/{id}` is one of the
two routes outside `/api/` that §13.13 confines `ctx` away from — so bytes could
not be *read* through `ctx` either, and there was no second door. (Bytes can be
**written** through it: `POST /api/media` is inside `/api/` and takes a multipart
body, which is what the importer's media half later turned out to rest on. The
asymmetry is deliberate and both halves are right — reading `/media/{id}` is an
unauthenticated route serving bytes to anyone holding an id, and writing is
`media:create`, a claim an operator grants.) A plugin whose whole
purpose is ingesting a file was therefore not awkward to write but
**impossible**, and that class of plugin is not marginal: a database export, an
archive, a spreadsheet, a font.

A route now declares what it takes:

```jsonc
{ "method": "POST", "path": "/source", "body": { "kind": "bytes", "max_bytes": 67108864 } }
```

Four things about that shape, and each is a decision rather than a default.

- **Declared, not sniffed.** Guessing from `content-type` would make the host
  responsible for a question only the route knows the answer to — the same
  argument `PluginServeRequest.body` already carries about who parses a body.
- **`body` and `bytes` are two nullable fields, exactly one ever filled.** A
  union reads better and travels worse: a handler written against one has to
  narrow, and the narrowing is on a value that already crossed a
  structured-clone boundary, where a string and a `Uint8Array` are the same kind
  of plain data and nothing but the route's own declaration tells them apart.
- **The cap is the author's to state and silo's to bound.** `max_bytes` is how
  much the host will allocate for whoever reaches the route, so it belongs where
  an operator approving `http:route` can read it — and behind a ceiling
  (`PluginRouteBodies.Ceiling`, 64 MiB) an author cannot raise, because
  "installing is the trust boundary" is an argument about *code* and not a reason
  to let a manifest name any integer. The honest way past the ceiling is a
  streaming body, which §13.18 rules out for reasons a number cannot fix.
- **The default is D36's behaviour, exactly.** A route that declares nothing gets
  text and one mebibyte, so this changed no existing plugin and no existing
  manifest's meaning.

### The route surface was outside the digest

`http:route` is **one** claim however many routes a manifest declares, so the
claim list could not see the route surface change at all. Three changes therefore
passed a standing approval untouched: adding a route, raising the body cap D41
had just made declarable, and — the serious one — adding `"auth": "public"` to an
existing route, which publishes everything the plugin was granted at a URL anyone
who can reach the port may call. None of them moved a claim, so none of them
moved the digest, so none of them moved the record to `needs_review`.

`routes` now sits in the `_plugins` record beside `hooks` and joins the digest,
canonicalised by `PluginGrantUtils.routeLine` as
`POST /source auth=key body=bytes:67108864` — readable rather than hashed, so an
operator diffing a `needs_review` record can see *which* route changed. It is in
the record and not read from disk because that is D38's rule for this whole
surface, and it is why `hooks` was already there.

A record written before D41 carries no `routes`, and `PluginGrantUtils.routesOf`
reads one as the empty list. That moves a plugin **with** routes to
`needs_review` once, which is correct rather than unfortunate: its route surface
had never been part of an approval, so there is a decision outstanding. Note this
reads a legacy field the opposite way from `requiredOf`, which reads an absent
`required` as *everything* — and the difference is not inconsistency. There, the
field's absence meant the distinction did not exist yet and every claim was
required; here, it meant the surface was never reviewed.

### A panel, and why it is served as data

§12.8 held custom panels back for a stated reason — *"only once an iframe message
contract is designed"* — because the admin SPA is content-hashed and embedded at
build time (D26), so a plugin cannot ship React into it. What made the contract
designable was a plugin that could not work without one, and what made it *safe*
was measuring the alternative.

**The alternative is a credential-exfiltration primitive.** The API and the admin
SPA are served from one origin, and the admin keeps `silo_servers` in that
origin's `localStorage` — holding an API key for **every** instance the operator
has ever configured. Plugin HTML rendered as a document from any `/api/` URL
could read all of them, which is strictly more authority than a plugin can be
granted at all. So:

- **A panel is declared** as `contributes.ui: { entry, title }`, one inlined HTML
  file. Not a directory: a directory means a static asset server inside the API —
  a path grammar, a content-type table, a traversal check per request — and every
  one of those is another way for plugin-authored bytes to be served from silo's
  own origin.
- **It is served as JSON**, by `GET /api/plugins/{name}/ui` behind
  `plugins:read`, with `nosniff` and a `default-src 'none'; sandbox` CSP. The
  bytes leave as data and nothing renders them on silo's origin.
- **The admin makes it a document**, in an iframe with `sandbox="allow-scripts"`
  and **no** `allow-same-origin`, mounted through `srcdoc`. That gives it an
  opaque origin: `localStorage` throws, `document.cookie` is empty, the parent is
  unreachable except by `postMessage`, and nothing it fetches carries a
  credential.
- **`..` in `entry` is refused at the manifest**, and the hazard is not the plugin
  reading its own files — a worker holds full Bun privileges and may already
  (§13.4). It is that *silo* reads that path and returns the contents over the
  API, so a climb would make the management API read whatever a manifest names.

### The contract, and which authority a panel spends

A panel's only capability is asking the admin to call a route of **its own
plugin**, and `readPanelMessage` is the whole of that boundary — pure, and tested
without a DOM, because a security check that needs a browser to exercise is one
nobody exercises.

The authority is the part worth stating, because it runs the opposite way from a
route's and both are right:

| | Acts as |
| :--- | :--- |
| The panel, asking | the **operator**, whose key the admin attaches |
| The handler, answering | the **plugin**, per §13.18 |

That is why no route here needs `auth: "public"`. A human is present, it is their
session, and the plugin's own grant is what the far side spends — so the panel
needs no authority of its own, and giving it one would be a second grant nobody
approved. The containment rule is what makes the relay safe to build: without
"only `/api/ext/<this plugin>/`", a panel would be a way to spend the operator's
full claim set on any endpoint, which is worse than the public-route hazard
`contributes.ui` exists to avoid.

**Paths are normalised before they are checked**, not after. `new URL` is what the
eventual `fetch` does with a relative path anyway, so a check against the raw
string checks a different value than the one that gets requested —
`/api/ext/x/../../keys` starts with the prefix and resolves to `/api/keys`. It
cuts both ways, which is the tell that it is the right check: `//..` resolves back
inside the namespace and is allowed, where a "contains `..`" rejection would have
refused a legal path.

Headers are an **allowlist** (`content-type`, `accept`), not a denylist. The value
being protected is the operator's `Authorization`, and a denylist would have to
name every spelling a panel might reach for and be wrong the first time one is
added — the same rule `ExtRequest.Withheld` states from the other side, chosen the
safer way round.

The panel-side half of the contract is **generated** by the admin
(`pluginPanelDocument`) rather than documented for authors to reimplement, and
that is the difference between a contract and a convention: every panel writing
its own `postMessage` correlation would get the same three things wrong, and
`PANEL_PROTOCOL` can only mean something while silo is the wire format's one
client.

### D33's guarantee had a hole, and background work fell in it

D33 says a plugin never hears about a write it caused, and says it without
qualification. It was implemented by copying the causal chain off the **waiter** —
and a waiter exists only while the dispatch that created it is open. So
`WorkerHost.serveRpc` gave an uncorrelated call `cause: []`, and a plugin that did
background work *and* declared a hook was delivered its own writes the moment that
work outlived its dispatch: `A -> A`, the exact shape D33 made unrepresentable
everywhere else.

§13.19 had looked at this code and reasoned about the **budget** — "genuinely
uncaused work has no deadline over it, so it gets one" — which is right, and the
same line drops the chain. The fix is `cause: [name]`: the plugin's own name,
which is what an equivalent hook-caused write already carries, so this is the
general case of an existing rule rather than a new one. Worth recording as a
pattern: when a guarantee is stated unconditionally and implemented from a
per-dispatch value, the question to ask is what happens once the dispatch is gone.

### What the plugin itself found

Two of these are about silo and two are about reporting, and all four were only
visible from a live run.

- **`POST /collections` is an upsert.** It answers 201 whether the collection was
  new or not, and replaces the schema either way. The importer read that status as
  "created, therefore empty" — so `skip` and `replace` both silently degraded into
  `append`, and every re-import overwrote a schema the operator may have edited.
  Two failures from one wrong inference, neither visible in the result. Existence
  is now *asked*, through the `schema:read` claim the manifest already requested
  for exactly that.
- **`projects.list`'s contract summary was wrong**, and `PluginTypesSource` emits
  it into the `silo:api` declarations every plugin author reads: it promised
  "each with its environments" where the route answers bare ids. Caught by the
  contract's own drift test the moment the summary was corrected, which is that
  test working as designed.
- **`silo plugin doctor` reported hooks and nothing else**, so a package
  contributing routes, a runtime and a panel read as `(no hooks)` — a report that
  sounds like a fault about a plugin doing exactly what it declared. D36's
  complaint about `kind`, in the one surface D36 did not revisit.
- **`create-silo-plugin` could not scaffold a routes-only plugin.** It refused an
  extension with no hooks, which was `ManifestReader`'s rule before D36 and stopped
  being it three phases ago — so an author had to name a hook they did not want, in
  the tool whose whole job is a correct first manifest. It now enforces the real
  rule ("would anything call it?") and can emit routes, a runtime and a panel;
  `--routes "POST /source+bytes:64"` is the grammar, and the ceiling it refuses
  against is drift-tested with the rest.

### Media, and the transport a database export cannot carry

Not a change to silo, and included because it is the part of the importer that had
to be **designed twice** — the first version was wrong in a way that passed every
test it had.

Strapi's export holds the `files` *catalog* and never the uploads: names, MIME
types, sizes, `/uploads/…` paths. So the first version imported a media field as
an object mirroring Strapi's own — `{ url, name, mime, width, height, size, alt }`
— which validated, imported, read back correctly, and was **inert**. Silo's media
type is `x-silo-type: "media"` on a *string* (D23), and everything silo does with
media keys off that: the admin renders the picker and a thumbnail, `MediaRefs`
extracts the reference so a delete is guarded by the usage, and a read rewrites the
value against the answering host. A faithful copy of the source's shape got none
of it, and nothing failed — which is the failure mode this repo keeps finding, a
correct-looking result with no behaviour behind it.

A media field is now that string, and what fills it degrades without changing
shape: `silo://media/<id>` where the bytes were supplied, the absolute Strapi URL
where they were not — silo resolves a foreign URL by leaving it alone, so that is
still a media value and not a broken one. Same `string` in the schema either way,
which makes "import now and send the files later" a re-import rather than a schema
migration.

**The transport is one file per request, and the alternative was measured rather
than assumed.** A zip of `public/uploads` through the same bytes route the `.db`
uses is the obvious shape and it fails on the number that decides it:
`PluginRouteBodies.Ceiling` caps **one request** at 64 MiB, and a real instance's
uploads directory is routinely larger — so an archive route could not carry the
case it exists for. Per file the cap becomes 64 MiB *per file*, which is the unit
silo's media library stores things in, needs no archive reader inside a plugin, and
makes progress, retry and resume fall out: `GET /files` says what is still
missing, so an interrupted run resumes by sending the rest. The live export used
to develop this wanted 530 files at 6.9 MB — under the ceiling, and only because
it is flags and logos.

Matching is by **filename**, which is what makes a browser directory picker usable
against a catalog read on the server: Strapi hashes an upload's name
(`Mastercard_0a2d4ecc1c.svg`) and writes it flat, so the basename of the `url`
column and the name in the operator's folder are the same string with no path
mapping in between. `name` will not do — that is the name the file was *uploaded*
as, and two `logo.svg` uploads share it.

Two findings from running it:

- **`POST /api/media` deduplicates nothing.** It mints a new id per request, so a
  `replace` re-import — the thing `replace` exists to let an operator do — doubled
  the media library and left the previous copies as unreferenced assets only
  `silo media reconcile` would ever mention. Measured on a live re-run. The plugin
  now asks whether silo already holds those exact bytes before uploading, matched
  on silo's own **sha256** rather than on the filename: Strapi's content hash in a
  name is a convention, a digest is a fact, and the digest is already in the
  catalog record. Whether silo itself should dedupe on `hash` is a separate
  question this does not answer — the plugin's own re-runs are the case that
  needed fixing, and a plugin cannot decide that two operators uploading the same
  logo want one asset.
- **`media:create` and `media:read` are optional, so refusal is an ordinary state
  rather than an edge case.** A 403 is read as an *answer*: stop uploading, keep
  the URLs, and say so **once** in the run's report. The alternative is one refused
  request per file and an import that reports nothing an operator could act on.

And the thing that does not come across, stated rather than approximated: Strapi's
`alternative_text` has nowhere to go, because a silo media asset records a
filename, folder, size, content type, hash and tags and no alt text.

Nothing of Strapi's **identity** comes across either. The importer used to add a
`strapi_id` per entry as provenance; it is gone, along with the special case that
forced `document_id` in beside it. Silo mints its own id (D2) and nothing on either
side resolves a Strapi one, so both were fields that looked like keys and were not.

### What D41 does not do

- **It does not stream a body.** Unchanged from §13.18 and unchanged by a bigger
  number: a request crosses the worker boundary as one value, so there is no
  back-pressure to be had. The ceiling is the honest form of that limit.
- **It does not give a panel authority of its own.** It spends the operator's,
  over one plugin's routes. A panel that wanted more would be asking for a grant
  nobody approved.
- **It does not serve plugin assets.** One HTML file, inlined, because every step
  toward a directory is a step toward third-party bytes on silo's origin.
- **It does not let a panel reach another plugin.** Plugin-to-plugin calls exist
  through `ctx` and are the plugin's own business (§13.18); a panel is a screen in
  somebody's session, and cross-plugin reach from one would be the confused deputy
  with a human's authority behind it.
- **It does not make a `Worker` a security boundary.** Unchanged since D31. The
  *iframe* is a real boundary — it has no origin and no credential — and that
  asymmetry is worth stating plainly: silo trusts plugin code and does not trust
  plugin markup, because the markup runs in the operator's browser next to the
  operator's keys.

## 13.21 Installing from the API, and what D34's split was actually protecting (D42)

D34 reserved `/api/plugins/*` for **grants and lifecycle** and said, in as many
words, that an API able to add a `[[plugins]]` block would be a code-execution
primitive wearing a management claim. Installing therefore meant a shell: `silo
add`, then `POST /api/plugins/rescan` or a restart. An operator running silo
behind a managed platform — a container they do not exec into, a host they reach
only over HTTPS — could not install a plugin at all.

`POST /api/plugins/install` is that verb, and the argument for adding it is that
**the thing D34 was protecting had already stopped being protected.** `rescan`
has, since D39, started arbitrary code named by `silo.toml` on the say-so of a
`plugins:enable` key. Whoever holds that claim can already decide that plugin
code runs; what they could not do was put the package on disk, which is a
different task, not a smaller authority. The boundary was in the wrong place, and
it cost the operator a terminal without buying a guarantee.

### The block carries no claims

What D34's split *does* still buy is the half worth keeping, and it is why the
block this writes looks the way it does:

```toml
[[plugins]]
name       = "silo-plugin-slugger"
claims     = []
timeout_ms = 30000
on_error   = "fail"
```

Effective authority is `silo.toml` **unioned** with the `_plugins` record
(`PluginGrantResolver.effective`), and the two halves are not equally guarded.
The record half passes `PluginGrantUtils.assertGrantable` — no `root`, none of
the six `PluginForbiddenClaims` — and `Claims.canDelegate`, is written through an
audited mutation, and can be taken back with `DELETE .../grant`. The file half
passes none of that: it is the operator's own file, and an operator editing it is
assumed to mean it.

An install that wrote claims into the block would therefore be minting a grant
that no check ever sees — not only on the install, but on every start
afterwards, because the file is re-read each time. So it writes `claims = []` and
puts every claim in the record, where all three properties hold. This is the same
split D34 stated, applied in the one direction that survives the API being able
to write the file: **registration in the operator's file, authorization in the
record.**

`silo add` still writes the manifest's required claims into the block, and that
divergence is deliberate. It runs for somebody with filesystem access — who can
already execute code — and it asks, at a terminal, before it writes. The API path
has a caller whose authority is bounded, and bounding it is the whole job.

### The order is the security property

Three of the four things that went wrong in the first cut of this were one
mistake wearing different clothes: **the side effects ran before the checks.**
The package was installed, the block written and the worker spawned, and only
then did `PluginGrantService.grant` apply `canDelegate` and `assertGrantable`.
Measured against a running instance:

- A key holding `plugins:enable` and `plugins:read` installed a plugin with three
  claims it could not delegate. It read `403 this key cannot grant plugin
  "greeter" more authority than it holds itself` — while the block was on disk
  with all three claims in it, the worker was running, and the plugin's route
  answered 200. The refusal was cosmetic and the escalation survived a restart.
- A manifest requiring `keys:create` — a claim `assertGrantable` says no plugin
  may **ever** hold, because a plugin with it can mint a credential the record
  does not bound — got it, by the same route.
- A default install of any package declaring routes or hooks *failed*, because
  the default read `permissions.required` and not
  `PluginGrantResolver.request().required`: the derived claims (`http:route`, one
  per declared hook) were missing, so `assertServable` refused the start. The
  block had already been written, and `PluginLoader.loadExtensions` does not catch
  a per-plugin start failure — so the next `serve` refused to boot. A failed API
  call had turned into an unbootable server, which is the exact outcome
  `PluginSupervisor.enable` orders its own steps to avoid.

`PluginInstallation` exists to hold the order, and it is the order
`PluginSupervisor`'s rule dictates — *the record must never describe a state the
next `serve` cannot reach*:

1. **Refuse before fetching.** A caller who names claims it cannot delegate, or
   claims no plugin may hold, is refused before a byte crosses the network. It
   needs no manifest to know that, and refusing early means no third-party code
   is fetched or unpacked on behalf of a request that was going to fail.
2. **Install**, which is where the manifest comes from.
3. **Refuse before running** everything the manifest decides: nothing past what it
   requested, nothing forbidden, nothing short of what it says it requires,
   nothing the caller cannot delegate.
4. **Start the worker**, still ungranted — the state every unapproved plugin is in
   at every boot, and the reason `assertDeliverable` and `assertServable` exempt
   an empty grant.
5. **Grant**, which mints the key and swaps the authority in through
   `PluginLifecycle.reapply` before the caller is told anything.
6. **Write the block last.** Everything before it can be undone; it has nothing
   after it to fail. A refusal at any earlier step takes the package back off
   disk (`PluginInstaller.uninstall`) and leaves `silo.toml` untouched, so a
   package that cannot start cannot make the instance unbootable.

Step 6 fails *softly*: if the file cannot be written the plugin is left running
and the response says it will not come back at the next start. That direction is
recoverable and the other is not, which is the same asymmetry `enable` and
`disable` order their halves around.

It also **creates the file** when the path this process was started with names
one that is not there. Before that, a first install into a directory with no
`silo.toml` was the failure the soft path was built to survive doing nothing
about: the package was fetched, the worker started, the grant minted, the
response said `201`, and the whole thing evaporated at the next start with a
warning nobody could act on except by writing the file by hand and repeating the
install. Creating it is safe for one specific reason — `ConfigScaffold` writes
silo's **own defaults**, and file values sit below flags and `SILO_*` env vars
(§10), so a file created behind the operator's back decides nothing the run had
not already decided. It differs from the `silo init` file by exactly the block
that was asked for.

What is still refused is *inventing the path*. A process handed no config file at
all — `SiloServer` built without a supervisor, an embedded host — has nowhere to
write, and guessing `./silo.toml` from a working directory nobody chose is a file
appearing in somebody's repository. That case keeps the warning it had.

`silo add` creates it on the same terms, one step later in its own sequence: the
claims are confirmed first, because a declined grant must leave the filesystem
where it found it.

A `--force` install is the one case with no clean undo: the previous directory is
already gone, so a later refusal leaves the replacement on disk, stopped and
unlisted, rather than leaving the operator with neither version.

### What D42 does not do

- **It does not lower the bar to installing.** `plugins:enable` was always the
  claim that decides whether plugin code runs. It does not add a narrower one,
  because a second claim would suggest a boundary between "start listed code" and
  "list code" that the file's own semantics do not support.
- **It did not remove a plugin.** That was the one item on this list that was a
  gap rather than a boundary, and D43 closed it: see §13.22. The objection was
  that uninstalling means editing `silo.toml`, which `PluginBlockWriter` could
  not do without re-serialising a file that is mostly comments, and that a record
  with a key attached needs a decision about the key rather than a file edit.
  Both turned out to be answerable — the first by removing a span of text and
  parsing the result before writing it, the second by discarding the key with the
  record.
- **It does not ask for consent.** `silo add` shows the claims and waits, because
  a terminal is a place to wait. The API's caller *is* the operator and its
  authority is checked; the admin shows the grant on the plugin's own screen
  immediately afterwards, which is where the reasons are.
- **It does not install dependencies.** Unchanged from D32. A plugin's dependency
  on silo is zero (§13.3) and nothing here grows a resolver.
- **It does not make an upload unbounded.** `formData()` buffers, so an archive is
  capped at 64 MiB — checked from `Content-Length` before the body is read and
  from the part's own size after, because the first is a claim and the second is
  what arrived.


## 13.22 Uninstalling, and why the order is the reverse of installing (D43)

`DELETE /api/plugins/{name}` takes a plugin off an instance whole: its
`[[plugins]]` entry, its worker, its record, its managed key and its package.
`PluginUninstallation` owns it, the way `PluginInstallation` owns the other
direction, and `PluginSupervisor.uninstall` is a thin delegate under the same
mutex — an operation that edits the config file *and* mutates the running set
*and* deletes a record must not interleave with a `rescan` that is reading all
three.

### The claim is the same one

`plugins:enable`, not a new claim and not `plugins:grant` as well. §13.21 argued
that `plugins:enable` already *is* the primitive that decides whether plugin
code runs; stopping code from running for good is squarely inside that. A grant
is destroyed here, but the direction `assertGrantable` and `canDelegate` exist to
bound is the other one: uninstalling only ever reduces what a plugin holds.

### The fence is conditional, and that is not a weakening

Every other mutation on this surface demands `If-Match`. This one demands it
**wherever there is a record to demand it about**. A package with no record —
one contributing only providers (§13.7), or listed and never loaded — has no
revision anybody could send, and requiring one would make it unremovable through
the API that installed it. `RouteAuth.findExpectedRev` reads the header
optionally; `PluginUninstallation` refuses without it the moment it finds a
record. The check is in the one place that can tell the two cases apart.

### The order

`PluginSupervisor`'s rule still decides it — *the record must never describe a
state the next `serve` cannot reach* — and read backwards it puts the steps here:

1. **Refuse on the revision first.** A stale `If-Match` must not cost a managed
   key on its way to a 409.
2. **Un-list it, and fail hard if that cannot be done.** This is the step the
   whole ordering exists for. A `[[plugins]]` block naming a package that is no
   longer on disk does not fail that plugin; it fails the **process**, because
   `PluginLoader.loadExtensions` has no per-plugin rescue. An uninstall that
   could not edit the file is an uninstall that must not proceed. Every later
   step is survivable.
3. Stop the worker.
4. **Forget the record**, which discards the managed key with it. After this, a
   re-installed package starts `pending` and unapproved. That is what makes
   uninstall a remedy rather than a tidy-up: what comes back does not come back
   holding what it held.
5. **Delete the package last, and forgive it.** A directory nothing lists and
   nothing has a record for is inert; on Windows it is also the step most likely
   to lose to a file handle the worker has not released yet. Reported as a
   warning rather than raised as a failure.

The audit entry is written last and **outlives the record**. `plugin.uninstall`
carries `detail.withdrawn` — what the plugin was able to do at the moment it was
taken away — and once the entry is deleted the trail is the only place that
answer exists.

### Removing a block without re-serialising the file

`PluginBlockWriter.remove` edits text, for the same reason `append` does: a round
trip through a TOML writer destroys every comment in a file `silo init` writes as
mostly comments. The span it removes is the header, the entry's keys, and **any
of its own sub-tables** — `[plugins.config]` belongs to the block above it, so a
span one table too short re-parents an operator's settings onto the *next*
plugin, which is a silent misconfiguration discovered at the next start.

Two guards, because that is the failure worth being paranoid about:

- The result is **parsed before it is written**, and the write is abandoned
  unless the remaining entries are exactly the ones that were there minus this
  one.
- Only silo's own note goes with the block, recognised by
  `PluginBlockWriter.AddedNote`, which `PluginInstallation` renders. An
  operator's comment is never this function's to delete — including `silo init`'s
  own explanation of the array, which sits directly above the first entry.

Line endings survive: the file is split on `"
"` only, so a `"
"` stays
attached to the line it came from and a CRLF config is not quietly rewritten.

### What it does not do

- **There is no `keep_files` option.** The half-way state it would create — a
  package on disk that no config lists — is precisely what `rescan` cannot see,
  and what an operator would later find and re-list without a record explaining
  why it was taken out.
- **It does not touch what the plugin wrote.** Collections and entries a plugin
  created are data the instance owns; only the plugin goes. The confirmation says
  so, because that is the question somebody asks before pressing it.

## 13.23 Observability is a core fact with a plugin presentation (D52)

`plugins/silo-plugin-observability` is the second first-party package. It shows
API volume, errors, latency, process resources and local storage, and it found a
different missing boundary than the Strapi importer did: a worker can observe
content lifecycle events, but it cannot honestly infer what happened at the
HTTP boundary or how much memory the host process owns.

The forcing consumer does **not** add an HTTP hook. Every request crossing into
a plugin worker would put a timeout, a queue and a new failure mode on the
workload being measured. It also does not tail the access log: request logging
may be off, filtered by level, written in either format, or have no file at all.
Instead the global request middleware records one bounded host-side aggregate,
independently of whether it emits an access-log line, and exposes it through
`GET /api/observability` behind `observability:read`.

The plugin stays ordinary: one declared `GET /snapshot` route calls that core
endpoint through `ctx.fetch`, and its sandboxed panel calls only its own route.
There is no private host escape hatch and no first-party privilege. A remote
metrics client can use the same endpoint and the same claim.

The privacy and memory bounds are part of the contract:

- series keys are the registered method and route pattern, never the requested
  path, parameters or query;
- callers, bodies, credentials, content and filesystem paths are never stored;
- latency is a fixed histogram and the chart is sixty one-minute buckets, and a
  percentile is clamped to the slowest request observed — a bucket boundary is
  an estimate, not a measurement, and reporting one above the maximum beside it
  is an impossible number rather than a conservative one;
- directory scans are cached background work, never follow symlinks, and stop
  after 50,000 entries;
- the data and media figures are **disjoint**: `[blob_storage] path` defaults to
  `<storage.path>/media`, so the data walk skips the media subtree rather than
  counting it in both, which keeps the two numbers addable and spends the entry
  budget once;
- remote-provider capacity is `null`, because storage adapters have no common
  capacity semantics and adding a port for one dashboard would be D7's
  speculative interface;
- everything resets at process start. Durable historical analytics can later
  consume snapshots externally without turning every request into a database
  write today.
