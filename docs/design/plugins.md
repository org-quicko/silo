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
  (`api` | `import` | `plugin:<name>`) so a plugin can ignore its own events,
  but it is context only; writing it into the entry would change the on-disk
  layout and force a `format_version` bump (D14) for a debugging convenience.

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

**D31 adds no new claim strings.** There is no install API at 1.0, so there is
nothing for a `plugins:manage` claim to guard; the config file is the
management surface. `http:intercept` and `http:route` arrive with the features
that need them, and adding a claim is additive because grants are
deny-by-default.

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
- Reentrancy is bounded by a depth counter on the context. A `ctx` write from
  inside a hook increments it; past the limit the call is refused rather than
  recursing.

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
