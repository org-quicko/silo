# Changelog

> Every change that altered behaviour, architecture or layout, newest first.
> The *current* state is [CONTEXT.md](../../CONTEXT.md); this is how it got
> there.

- **`ctx` becomes the HTTP API, dispatched in-process (D35, phase 3,
  2026-08-25).** A plugin's `ctx` call is now a request against the same Hono
  app a network request hits, so the guard a plugin meets is the guard a key
  meets. §13.15 in [../design/plugins.md](../design/plugins.md).
  - **`PluginContext` went from five methods to one.** The five hand-rolled
    claim checks are *deleted, not widened to forty*: widening would have
    re-implemented `requirePublicOrClaim`, the transfer permission lists and the
    media-usage disclosure rule as a second evaluator free to disagree with the
    first, which is exactly what `@silo/shared/claims` exists as one facade to
    prevent. The surface now grows for free — a route added in 1.x is a plugin
    capability with no plugin work.
  - **The principal is attached, never presented.** It travels on
    `app.request`'s `env` under a module-private symbol, which nothing arriving
    over a socket can reach: `env` is the runtime's bindings object, and no
    header, query parameter or body shape becomes a symbol-keyed property. That
    is why `ctx.fetch` drops `Authorization` and `X-Api-Key` outright — a worker
    never holds its own secret, so **the channel is the credential**.
  - **The middleware reads the injected principal before the `--no-auth`
    branch**, closing D37's fifth finding. `--no-auth` gives every request
    `["*"]`, which is right for what it means and becomes wrong the instant
    `ctx` dispatches through the same middleware: every plugin on every
    development instance would have silently held root, which is precisely where
    plugins are written and tested. The test asserts both halves on one
    instance — the anonymous request still gets 200, the plugin beside it 403.
  - **`ctx` is confined to `/api/`,** by resolving the path against a fictional
    origin and requiring the result to still be that origin. One check catches
    three shapes: `..` is normalised away before the prefix is tested,
    `//example.com/api/x` lands on another origin, and an absolute URL never had
    a chance. The SPA fallback and `/media/{id}` sit outside the auth middleware
    entirely, so reaching them would mean reaching *unauthenticated* routes with
    a principal nothing reads.
  - **D33's causal chain rides the same slot as the principal,** because they
    are one fact: who is asking, and what caused them to ask. Write routes read
    it back through one `RouteAuth.getWriteContext`. The new `selfwriter`
    fixture writes into the collection it hooks, so a dropped chain is an
    immediate loop rather than a bounded one.
  - **A `ctx.fetch` is bounded by what is left of its dispatch's budget,** minus
    a margin. Bounded by exactly the remainder it loses the race to
    `WorkerHost`'s dispatch timer every time, and the worker is killed for the
    dispatch running long instead of the plugin being told which call did it —
    which, until phase 4's supervisor, is permanent and silent. A call outside
    any dispatch gets the full `timeout_ms`, because it had no deadline at all.
  - **One contract, two emitters.** The plugin-facing surface was mirrored by
    hand in three places — the host's method switch, the worker bootstrap, and
    the `silo:api` declarations — with nothing but review keeping them in step.
    `PluginApiContract` is the one description; `PluginClientSource` emits the
    worker's client at start (so there is no second copy to drift) and
    `PluginTypesSource` emits the `SiloContext` members, which a test pins
    because `tsc` reads files.
  - **A dispatched request has no origin, so it writes no media URLs.** Found by
    the smoke test: a route expands `silo://media/<id>` against the request's
    `Host` header, and a dispatched request's only host is the fictional one
    paths resolve against — so a plugin was handed
    `http://plugin.silo.internal/media/…` to store or forward. `getBaseUrl`
    returns `""` for one, leaving the reference exactly as stored, which is what
    `ctx` handed plugins before this phase.
  - **The access log names the plugin.** It now contains lines no client sent,
    and without `plugin=<name>` an operator reading one sees traffic from
    nobody.
  - **Breaking, for plugin authors:** `ctx.entries.list` returns the route's
    body, so its rows are under `data` rather than `items`. The client mirrors
    the HTTP API wart for wart — entries and search page under `data`, media and
    collections under `items` — because smoothing it over would cost the
    property the design is for: the same client running against a remote silo.
  - **Still phase 4's:** revoking a grant destroys the managed key immediately
    and the running plugin keeps acting on the claims it loaded with. Measured
    live. Half-fixing it would be worse than leaving it — hook delivery reads
    the same in-memory grant, so a plugin whose `ctx` is dead while its hooks
    still fire is a new inconsistent state.

- **Plugin management gets an API, and authority changes get a trail (D38,
  phase 2, 2026-08-25).** `/api/plugins/` stops being a reserved 404 and becomes
  the management surface; a fourth system collection, `_audit`, records who
  changed what.
  - **The management API manages the record, not the package.** `GET
    /api/plugins`, `GET /api/plugins/{name}` (with an `ETag`), `PUT`/`DELETE
    .../grant` and `POST .../enable|disable`. Everything reads and writes
    `_plugins`; nothing reaches the filesystem, which is D34's
    registration/authorization split holding one layer up — an API that could
    add a `[[plugins]]` block would be a code-execution primitive wearing a
    management claim. `PUT` and not `POST` on the grant, because the body is the
    complete granted set, so narrowing is expressible without first revoking.
  - **`If-Match` is required on every mutation, and on a grant it is the
    mechanism rather than ceremony:** approving means approving *what you read*.
    Without the fence, a package whose request changed between the operator
    reading it and approving it is approved on the strength of the older one —
    `needs_review`'s substitution arriving through the API instead of through an
    upgrade.
  - **The obvious ordering inside `grant` was wrong, and it shipped briefly.**
    Rotating the managed key before writing the record meant a refused write —
    a stale `If-Match`, the common case — discarded the *live* key and left the
    record pointing at one that no longer existed, plus an orphan in `_keys`.
    Write-then-rotate is worse the other way: the previous, possibly wider key
    stays live after the record says it was narrowed. Only mint → write →
    discard is safe at every step. `revoke` now checks the revision before
    discarding, for the same reason.
  - **Found by an end-to-end smoke test, not by the suite** — the second time in
    three phases. The regression test now reaches past the record into `_keys`,
    because "the record is unchanged" was exactly the assertion that passed
    while a credential was being destroyed.
  - **`reconcile` no longer writes when nothing changed.** It runs for every
    plugin at every start, so an unconditional write bumped every revision on
    every restart and invalidated every outstanding `If-Match` for a change
    nobody could point at. Measured on a running instance: four restarts walked
    one plugin from rev 1 to rev 7.
  - **`enabled` is orthogonal to the grant.** A disabled plugin keeps its claims
    and its managed key — pausing is not un-approving, and an operator who had
    to re-approve after every pause would learn to approve widely. Guarded by
    `plugins:enable` rather than `plugins:grant`. Until phase 4 it takes effect
    at the next start and **every surface says so**: `restart_required: true` in
    the response, a warning from `PluginLoader`, `[granted, disabled]` in
    `silo plugin list`, and a non-zero exit from `silo plugin doctor`.
  - **The trail.** `_audit` joins `_keys`, `_media` and `_plugins` as a reserved
    system collection, so it gets every adapter and query for free and is
    excluded from archives and the entries API by rules that already existed.
    Only authority changes go in — entry writes are what `rev`, `updated_at` and
    the hook stream already are. The **services** append rather than the routes,
    so `silo keys create` and `silo plugin grant` are in it too; an append that
    fails is logged at `error` and does not undo the change, because telling a
    caller its change failed when it succeeded invites a retry against state
    that has already moved. Retention is unbounded on purpose: an authority log
    grows with decisions, not with traffic.
  - **Audit event ids are monotonic ULIDs**, unlike every other id in silo.
    Plain `ulid()` re-randomises its suffix per call, so two events in the same
    millisecond sorted either way — and `at` ties there too, leaving "newest
    first" undefined for exactly the burst a trail most often records: a grant
    and the key rotation it causes. A flaky test found it. The factory is local
    to the trail, since entry ids have no ordering requirement.
  - **The admin UI stopped silently dropping claims it had no words for.**
    `ClaimGroups` renders a claim set as readable sentences so someone can
    catch a mistake before minting a credential — and it omitted anything
    missing from its table, so between D34 and D38 a key holding
    `plugins:grant` (the authority to hand running code a claim set)
    summarised as **nothing at all**. The five plugin and audit claims are
    named now, and an unrecognised fixed claim falls into an `Also` group
    flagged as a warning rather than vanishing — which fixes the *next* claim,
    not just these. They are also selectable on the guided key-creation page,
    where the `plugins:*` claims had never appeared.
  - **New fixed claim `audit:read`**, carried by `manage` and `root`. No
    `audit:write` — nothing updates or deletes an event, and a claim guarding
    that would imply a capability that does not exist.
  - **D37's fourth finding is closed.** `POST /api/keys` records `parent_id`,
    and revoking a key revokes everything descended from it, transitively. Not
    behind a `?cascade=true` flag: putting the correct behaviour behind an
    argument nobody passes is the same as not having it. The response stays 204;
    what went is in the trail, `silo keys revoke` prints it, and `KeyView`
    exposes `parent_id` so a caller can see what a revocation would take first.
  - **Two supporting changes with teeth.** `KeyService.authenticate` now returns
    an `AuthenticatedKey` carrying the record id — which `granted_by`,
    `parent_id` and the audit actor all needed and none could get. And
    `GrantRequest.keyId` became a **required** `actor`, so no call site can
    change a grant without saying who: the one thing an audit trail may never
    contain is an anonymous entry, and a field that defaults quietly is a field
    that will.
  - **Deliberately not shipped:** `POST /api/plugins/rescan` and `PATCH
    .../config`. Both need a manifest read from disk and both only take effect
    once phase 4 can reload without a restart, so shipping them now would be an
    API whose whole answer is "restart to find out". §13.14 in
    [the plugin design](../design/plugins.md) has the detail.

- **The route-authority audit, and three holes it closed (D37, 2026-08-25).**
  D35 made this audit the gate on phase 3, because `ctx` becoming an in-process
  dispatch of the HTTP API turns every route guard into a plugin guard. It found
  live bugs in the *shipped* API, not hypothetical ones in the planned one.
  **This tightens authorization on three routes.**
  - **A forced delete now asks for the authority to destroy what it destroys.**
    `DELETE .../collections/{name}/schema?force=true` required
    `collection:delete` and nothing else, and erased every entry underneath;
    `DELETE /api/projects/{p}?force=true` did it across every environment.
    Measured: one claim over one collection deleted three entries and returned
    204. Without `force` these routes refuse while content exists, so
    `collection:delete` alone is honest — the caller is removing an empty
    definition. With it, the same request is a bulk `entries:delete` wearing a
    lifecycle claim, dispatching no hooks and asking for no revision. `force`
    now also requires `entries:delete` at the reach it erases, through one
    `RouteAuth.requireForcedDelete`. This is the rule `replace` mode already
    applies to transfer and scope copy; forced deletion was the third place the
    same thing was true and the only one where nobody had written it down.
  - **The admin UI gates on the same list, not a copy of it.** The pair lives
    on `Claims` as `ForcedDeletePermissions`, following `TransferPermissions`
    and the rule `RouteAuth.requireInstanceWide` already states — an
    affordance the server will refuse is worse than no affordance. Three
    delete buttons moved to it, and two of them were *already* looser than
    their route: the environment and project pages asked
    `hasAnyCollectionPermission`, which is "delete on some collection here",
    to authorize deleting all of them. Their hint text named the wildcard
    claim the route wanted, so the message had been right and the check
    wrong. Both now use `hasScopeWide`. The keys page gained the matching
    per-row rule, and stops offering Revoke on a managed plugin key — a
    button that has 400d since D34 phase 1.
  - **Revoking a key is bounded the way minting always was.** `POST /api/keys`
    has checked `Claims.canDelegate` since D12; `DELETE /api/keys/{id}` checked
    `keys:revoke` and stopped. Measured: a key holding *only* `keys:revoke`
    revoked the root key, after which the root secret returned 401 and the
    instance had no administrative credential at all — unrecoverable without
    filesystem access. Not an escalation, and worse than one in the way that
    matters operationally. The bound is now the same predicate: **if you could
    not mint a key this powerful, you may not destroy one.** A key still revokes
    itself, since a claim list covers itself.
  - **Three more claims a plugin may never hold.** `keys:import` is the
    sharpest: an import writes `_keys` rows verbatim — system collections skip
    validation — so an archive can carry a key record whose hash the author
    chose and whose claims are `*`. Measured: the planted record authenticated
    as root on the next request. `keys:create` mints an **unmanaged** key, a
    credential with no `owner` that `silo plugin revoke` therefore does not
    withdraw. `keys:revoke` destroys other principals' credentials. All three
    joined `PluginForbiddenClaims`; `keys:read` and `keys:export` deliberately
    did not, because they disclose the authority map rather than change it.
  - **Why D34's forbidden set missed them.** It was reasoned as "a plugin must
    not widen its own grant", which names `plugins:grant|enable|configure`
    exactly and misses `keys:import` completely — because `keys:import` does not
    widen the record, it makes the record irrelevant. A security predicate
    stated as an intent does not enumerate its own membership; the question has
    to be asked mechanically, per claim. That is what an audit is for, and it is
    the reason this one was worth doing before phase 3 rather than after.
  - **Four findings recorded and not fixed**, each with the phase that owns it:
    a minted key still outlives its minter (phase 2, with the key audit trail);
    `--no-auth` sets `claims: ["*"]` and would hand every plugin root once `ctx`
    dispatches through the same middleware, so phase 3 must read the injected
    principal *before* the `authDisabled` branch; `CollectionEraser` dispatches
    no hooks, so bulk erasure is invisible to auditing plugins (phase 6, as a
    collection-level hook rather than a 100k-event fan-out); and `/api/copy`'s
    outbound fetch to an operator-supplied URL, accepted because a Worker holds
    `fetch` regardless.
  - **What it pinned as much as what it changed.** The system scope is
    unaddressable over HTTP because `Scope.of` refuses a `_`-prefixed id — the
    single boundary that makes "a plugin is an API key with code attached" safe
    to say. And all four hook dispatch sites sit **outside** `withWriteLock`, so
    a hook writing back through the HTTP surface takes a free lock rather than
    waiting on the one its own caller holds. `AsyncMutex` is not reentrant, so
    that is D33's deadlock waiting to return if a dispatch ever moves inside the
    lock. Both are now assertions in
    `apps/server/test/http/route-authority.test.ts`, the second one measured on
    the clock rather than on a count, for the reason D33 recorded.
  - The phase-3 requirements the audit produced are in §13.13 of
    [the plugin design](../design/plugins.md).

- **Plugins become granted principals (D34, phase 1, 2026-08-25).** Hook
  delivery is now a claim, grants live in the store, and each approved plugin
  gets a managed API key. **This is a breaking change to `silo.toml`.**
  - **The two holes it closes.** `HookBus` dispatched to any runtime that
    declared a hook, with no claim check at all — a plugin granted *nothing*
    could declare `entry.beforeValidate` and rewrite every entry write in the
    instance. And `PluginLoader.assertGranted` enforced `requested ⊆ granted`
    but never the converse, so a config could grant past the manifest.
  - **A third claim shape.** `hooks:<project>/<env>/<collection>:<hook>`, in
    `@silo/shared` alongside the other two, with `ParsedClaim` gaining a `hook`
    kind. No collection permission satisfies it and it satisfies none — being
    handed a value before validation is not reading a committed one. The check
    runs *before* the event crosses into the worker, so an event a plugin may
    not have never leaves the host. The hook segment takes no wildcard (D19).
  - **Requests are derived, grants may narrow.** A manifest does not restate
    hook claims; they come from its declared `hooks` at `*/*/*`, and a grant may
    narrow the scope. It may not be absent — a declared hook nothing delivers
    refuses the start, printing the line to add. That is D30's rule about absent
    declarations, applied here.
  - **`_plugins`, and the split that matters.** Grants live in a reserved
    system collection; `silo.toml` still says which plugins load and in what
    order. *If grants lived in config, revoking would need a restart; if
    registration lived in the store, whoever could write the store could execute
    code.* `[[plugins]] claims` survives as a declarative grant for immutable
    deployments, and effective authority is the union, both halves bounded by
    the request.
  - **Managed keys.** Approving mints a `_keys` record owned by the plugin,
    carrying exactly the granted claims; its secret stays host-side. Three
    places had to learn about them: `keys revoke` refuses one (silo re-mints
    it, so revoking by hand undoes itself), `bootstrap` does not count one (an
    instance whose only keys were managed would have no way in and would report
    itself bootstrapped), and `--with-keys` leaves one out of the archive.
  - **Pending is a state, not a failure**, and needs no code path: it is an
    empty claim list, which every check already refuses. It does not refuse the
    start — approving needs a server to approve through — so it is loud instead:
    a warning per start, `[pending]` in `plugin list`, non-zero from
    `plugin doctor`.
  - **New:** `silo plugin grant <name> [--claims a,b]` and `silo plugin revoke`,
    both offline against the data directory; claims `plugins:read|configure|
    grant|enable`, with the last two in `root` only; `/api/ext/` reserved for
    plugin routes so `/api/plugins/` can be the management surface (D36).
  - **Migrating:** every `[[plugins]]` block needs a `hooks:*/*/*:<hook>` claim
    per declared hook, or the start refuses and names them. `create-silo-plugin`
    emits them, and `silo plugin grant` writes them for you.
  - 668 tests pass. A CLI smoke test caught what the suite did not: `--claims`
    was read from the positionals, where `parseArgs` had already consumed it, so
    a narrowed grant and a refused over-grant both silently granted everything
    requested.

- **A hook that writes through `ctx` no longer deadlocks and kills its own
  plugin (D33, 2026-08-25).** Plugin causality became a chain instead of a
  counter, and the per-plugin dispatch lock is gone.
  - **The bug.** `PluginRuntime` held an `AsyncMutex` for the length of a
    dispatch so that `PluginContext.depth` — one mutable field serving
    callbacks *during* a dispatch — could say which dispatch a callback
    belonged to. A hook calling `ctx.entries.create` re-entered `EntryService`,
    which dispatched `afterWrite` back into the **same** runtime, which blocked
    on the lock its own caller was still holding while awaiting the worker.
    The dispatch ended only at `timeout_ms`, and `WorkerHost` then killed the
    worker with no restart (D31 chose that deliberately). So the first `ctx`
    write from a hook was also the last: three entries created against the
    `mirror` fixture produced **one** mirror.
  - **Why the suite was green.** `EntryService` writes to the store before
    dispatching `afterWrite`, so the entry the assertion looked for had already
    landed. The only symptom was duration — 5.53 s against `timeout_ms: 5000`,
    1.56 s against `timeout_ms: 1200`, tracking the budget exactly.
  - **The fix.** `WriteContext` and `HookEventBase` carry `chain` — the plugins
    whose hooks are above this write — and `HookBus` skips any plugin already
    in it, so a plugin never hears about a write it caused and a cycle is
    unrepresentable rather than bounded. The worker tags each callback with the
    dispatch id it came from; `WorkerHost` looks the chain up in its own record
    of that dispatch and hands it to `PluginContext.call`, which is now
    stateless. The mutex is deleted rather than made re-entrant — a re-entrant
    lock would have unblocked the direct case and still allowed `A -> B -> A`.
  - **What plugins see.** Nothing new. The chain stays host-side and reaches a
    plugin as `event.depth`, its length, so the drift-tested `silo:api`
    declarations moved only in a doc comment: the advice to check `origin` for
    your own writes became a description of what the host now does for you.
    `MaxDepth` survives as a cap on how many *distinct* plugins may chain off
    one request.
  - **Tests.** The `mirror` fixture is now deliberately naive — its manual
    `origin` guard is gone, because a fixture that guards tests the guard
    rather than the host — and its test asserts three writes, three mirrors,
    **and** an elapsed time under the timeout, since either alone would have
    passed. A new `pinger`/`ponger` pair pins the indirect cycle no `origin`
    check could ever catch. 635 tests pass.
  - **Designed alongside it:** D34–D36 (plugins as granted principals with a
    managed API key, `ctx` as the in-process HTTP API, contributions replacing
    kinds, `/api/ext/` reserved for plugin routes). None of it is built; see
    §13.11.

- **The repository is restructured around a workspace layout (2026-08-25).**
  Nothing about silo's behaviour changed; where its code lives, and how much of
  it is in any one file, did. The full suite (634 tests) passes at every step
  of the move, which is what made a change this wide safe to make at all.
  - **The tree.** `server/` → `apps/server/{src,test}`, `ui/` → `apps/admin/`,
    `shared/` → `packages/shared/`, `create-silo-plugin/` →
    `packages/create-silo-plugin/`, `scripts/` → `tools/`, and a new
    `plugins/` for first-party plugins. The root `package.json` is now a
    workspace root with no runtime dependencies: the server's moved to
    `apps/server/package.json` (`@silo/server`), and `silo-ui` became
    `@silo/admin`. What the root keeps is the `version`, because D28 makes it
    the single source of truth and the release workflow checks the tag against
    it.
  - **Why the root was asymmetric before.** `server/` *was* the root package —
    root `main`, root dependencies, root scripts — while the other three were
    workspace members beside it. That is a fine shape for one deployable and a
    library; it has no room for a plugins directory, and every new sub-package
    added another top-level entry next to `packaging/` and `silo_data/`.
  - **`Service` is gone, and `SiloService` took its place.** 1,590 lines
    covering projects, environments, collections, entries, search, keys,
    transfer and the whole media subsystem became a facade over seven services
    with one subject each, plus a `media/` directory of six. Call sites read
    `service.entries.create(...)` and `service.media.save(...)`. The shared
    collaborators — the two ports, the schema cache, the instance write lock,
    the hook bus — moved onto a `ServiceContext` that each service holds,
    which is also what keeps the write lock a single object (D25 depends on
    that).
  - **Both storage adapters split per table.** `FsStore` (668 lines) and
    `SqliteStore` (625) are now `Storage` implementations that compose
    per-concern stores: scopes, schemas, entries, media references, and — on
    SQLite — the FTS document table. `FsLayout` holds the on-disk path grammar
    in one place, which matters because that layout *is* the export format
    (D5). The cascading deletes stayed inside their transactions.
  - **The CLI split three ways.** `Cli` parses argv and answers `help` and
    `version`; `CliOptions` owns the flag table and the config overrides;
    `CommandRouter` routes in the three tiers the old `run()` already had
    implicitly (before config, before storage, against the data dir); and
    `SiloRuntime` does the dependency wiring. The 106-line usage text is its
    own file, because it is documentation and is edited when a flag changes,
    not when the routing does.
  - **`Claims` became a facade.** The 488-line class is now
    `ClaimVocabulary` (the strings and the completeness tables),
    `ClaimGrammar` (parse, validate, normalise), `ClaimPresets`,
    `ClaimAuthorizer`, `ClaimSummary`, and the two permission-list classes.
    `Claims` extends the vocabulary and delegates the rest, so
    `@silo/shared/claims` is unchanged for every caller and there is still
    exactly one evaluator of the claim grammar.
  - **The admin UI.** `ApiClient`'s 45 methods became `SiloApi` over eight
    resource clients sharing one `HttpTransport`, so the bearer header, the
    error shape and the 401 redirect are stated once. `components/` grouped
    into seven directories. `ServerManager` (670) became a shell over three
    column components and a `useScopeBrowser` hook; `MediaLibrary` (616),
    `SchemaEditor` (624), `NewKey` (476), `Entries` (479), `Workspace` (400)
    and `ConnectionPage` (398) each gave up their state to a hook and their
    panels to components. Pure logic left the components entirely —
    `SchemaDraft` is the JSON Schema ↔ field-list translation, `MediaFilter`
    compiles a media search, `EntryLabels` decides what an entry is called.
  - **`storage-conformance.ts` (1,049 lines) became seven suites** over a
    shared `StorageTestContext`, registered by one entry point. Same 634
    tests; the count is the check that nothing was lost in the split.
  - **`seed.ts` (1,254) and `build.ts` (274) became directories.** The seeder
    documented itself as deliberately one file so it could be copied to a
    remote machine; that property now comes from
    `bun build tools/seed/main.ts --target=bun --outfile seed.js`, which is one
    command and buys twenty-one readable files.
  - **Names and comments.** `svc`→`service`, `cfg`→`config`, `opts`→`options`,
    `err`/`e`→`caught`, `res`→`response`, `st`→`store` and the rest, across
    every package. Essay-length doc comments were cut to what a reader needs at
    the call site, with the rationale moved into `docs/design/`; the longest
    remaining non-usage block is 21 lines, down from 37, and comments are 15%
    of source lines.
  - **The docs split.** `CONTEXT.md` was 2,326 lines, almost all of it this
    changelog; it is now a short index and the log lives in
    `docs/context/changelog.md`. `IMPLEMENTATION.md` keeps the vision, the
    decisions log and the v1 scope, and §4–§13 moved to `docs/design/`, one
    topic per file. Section numbers are unchanged, so every `§13.5` in the code
    still means what it said.
  - **What did not change.** No route, no claim string, no on-disk layout, no
    `format_version`, no config key, no CLI flag. The one visible rename is
    `MediaQuery.q` → `MediaQuery.text`, an internal DTO field the HTTP layer
    maps `?q=` onto.
  - **Two things to know about the move.** Bun 1.3's default install linker is
    isolated rather than hoisted, so a workspace's dependencies resolve from
    its own `node_modules` — stricter, and the reason
    `validation-error.test.ts` now names the three real install roots instead
    of the repo root, which no longer depends on `@silo/shared`. And the
    Dockerfile's `COPY` list must name every workspace manifest: adding a
    member without adding it there breaks the image build and nothing else.

*Last updated: 2026-08-24*

- **`silo add` installs plugins (2026-08-24, D32/§13.8).** The thing D31
  deliberately did not ship. `silo add <spec>` takes five source kinds — a
  local directory, a local `.tgz`, an npm name and range, an https tarball URL,
  and a git repository — unpacks one package into `<data dir>/plugins/<name>/`,
  and appends a `[[plugins]]` block to `silo.toml`. `silo plugin add` is
  accepted as the same command, because §12.8 called it that for months before
  it existed. There is no `remove`: unlisting a plugin is deleting its block,
  which is a thing an operator can already see how to undo.
  - **It is additive because it sits *above* the load path, not inside it.**
    `PluginInstaller` calls `ManifestReader` and `PluginLoader` to judge what
    it fetched; neither knows it exists. What lands on disk is the directory
    the resolution rule D31 froze ahead of exactly this — so `serve`, `plugin
    list|info|doctor` cannot tell an installed plugin from a copied one, and
    every 1.0 refusal still holds. The install path only *adds* refusals.
  - **`apps/server/src/plugins/install/` is the fifth submodule**, and the only one the
    load path never calls. One artifact per file: `SourceParser` (the spec
    grammar), a `PackageFetcher` port with five implementations,
    `PackageExtractor` (the security core), `Integrity`, `NpmRegistry`,
    `TarballDownload`, `PluginLock`, `PluginInstaller`.
  - **Verification is graded by source rather than flattened, and says which
    it got.** npm is checked against the registry's own `dist.integrity` before
    unpacking — the one case where the digest and the bytes come from different
    places. A URL is checked only against `--integrity` if the operator has one,
    and warns when it does not. A local tarball gets a digest computed on the
    spot, so the *second* install of the same file is checked. A directory
    transferred nothing. A git checkout is pinned by resolved commit. A single
    "verified" claim covering all five would have been the dishonest
    simplification.
  - **`--integrity` is honoured by every source with bytes to hash, and refused
    by the two without.** It was originally wired to `url` alone and silently
    dropped everywhere else — the worst handling available for a security flag,
    since the operator types the argument meaning "check this", the install
    proceeds unchecked, and no output separates that from a verified one. It
    now applies to `tarball` and `npm` as well, and `directory`/`git` say why it
    cannot. On npm it is **not redundant**: the registry supplies both the
    tarball and the digest it is checked against, so an independently known
    digest is the one thing a compromised registry cannot satisfy. The two are
    joined into a single SRI string rather than checked in sequence, because
    `Integrity.verify` already requires *every* digest it is handed to match —
    no second code path, and the check still lands before a byte is written.
    Applicability and shape are both settled in `PluginInstaller` before any
    network or disk work, so a typo costs a millisecond instead of a download.
  - **Extraction is the part that had to be right.** §13.8 named one
    requirement of any installer — reuse `EntryUtils.assertSafeSegment` — and
    that is where it happens: every path component of every entry, through the
    same check the fs adapter puts a collection id through. Absolute paths,
    `..`, symlinks, hard links, device nodes and **setuid/setgid/sticky mode
    bits** are refused, and the archive is **validated in full before a byte is
    written**, so a hostile package leaves nothing behind rather than half a
    package and a warning.
    `apps/server/test/plugins/hostile-archive.test.ts` builds those archives by hand
    (tar's own packer refuses to write an escape, which is why it is no use
    here) and pins both halves: refused, *and* nothing written.
  - **The mode bits are the one weapon that needs no plugin to ever load**, and
    they were missed on the first pass — found by the security review. `tar`
    carries an entry's mode through to the mode it creates the file with,
    keeping all twelve bits, and the umask masks only the low nine, so a
    `0o4755` entry becomes a setuid file during *extraction* — before the
    manifest is judged, before the claims prompt, and even under
    `--no-register`, where the operator has said they do not want the thing to
    run. Everything else about installing a plugin is the operator's decision;
    that would have been a privilege granted by a tar header. Refused rather
    than stripped, matching the rest of the class: no good-faith plugin ships a
    setuid binary, so silence would be the wrong answer — and stripping would
    leave silo betting on `tar` never changing how it applies modes. An
    ordinary `0o755` script is untouched; the check is about privilege, not the
    executable bit.
  - **Two fail-open bugs, both caught rather than reasoned about.** Throwing
    from inside tar's `onentry` escapes into the stream and settles it neither
    way — the archive that most needed refusing would instead have hung the
    command refusing it; violations are now recorded and thrown after the walk
    completes. And an empty `--integrity` (`--integrity "$UNSET_VAR"` in a CI
    script) used to pass three gates at once: falsy where a malformed digest is
    rejected, falsy again where the comparison happens, and `!== undefined`
    where `add` decides whether to warn that nothing checked the download — so
    an empty digest was *quieter* than no digest, and recorded `""` in the
    lockfile instead of the computed pin. `UrlFetcher` now validates once, in
    its constructor, on **presence rather than truthiness**, so past that point
    `expected` is either absent or a digest and every downstream reading of it
    agrees. `TarballDownload` tests presence too, which makes
    `Integrity.verify`'s own empty-string refusal reachable instead of dead.
    The lesson both share: a truthiness test standing in for a presence test is
    how a security check turns itself off.
  - **Nothing is executed, and no lifecycle script ever runs.** The manifest is
    judged statically (§13.2), the `silo` range is checked against this binary,
    and a provider is refused a reserved driver name — all before the package
    could import a line. The package stages *inside* the plugins directory so
    the final move is a rename rather than a cross-device copy, and a failure
    after the move rolls back, empty scope directory included.
  - **The lockfile is a record, not a resolver.**
    `<data dir>/plugins/silo-plugins.lock.json` holds name → source, spec,
    resolved version/commit/path, digest, timestamp. Nothing reads it at
    startup, `serve` still loads exactly what `silo.toml` names, and deleting it
    breaks nothing — a lockfile that gated loading would be a second source of
    truth beside the file D31 made the whole management surface. What it buys
    is the question a `[[plugins]]` entry cannot answer six months later:
    which version is this, where did it come from, were the bytes the published
    ones.
  - **The config is appended to, never re-serialised** (`PluginBlockWriter`,
    in `apps/server/src/config/`). `silo init` writes a file that is mostly comments on
    purpose, and a TOML round trip would produce a semantically identical file
    with all of them gone. Appending is also *correct* for this array
    specifically: its order is hook dispatch order, so a new plugin dispatching
    last is the only default silo can defend. Duplicates are detected through
    the real parser, not a regex over the text.
  - **The claims prompt is the CLI's only interactive question, and is not a
    UX preference.** §13.6's distinction is that a manifest *requests* claims
    and an operator *grants* them; an installer that copied the request through
    would have collapsed the two and let a package author its own permissions.
    So `add` prints what would be granted and asks. A non-interactive stdin is
    a **no** — `silo add` in CI fails naming `--yes` rather than granting what
    nobody was watching. `--claims` overrides the grant, and a grant that does
    not cover what the manifest requests is refused *here*, since `serve` would
    refuse to start on it anyway.
  - **Routed before storage is opened**, with `init`/`stop`/`status`/`logs`: it
    writes a directory and a config file and opens neither the database nor a
    plugin, so it is safe against a data dir a live server owns. What it
    changes takes effect on that server's next restart — §13 loads plugins once
    at startup and nothing reloads them, which `add` says out loud when it
    finishes.

- **`S3BlobStorage` runs on Bun's built-in `S3Client` (2026-08-24).**
  `@aws-sdk/client-s3` is gone from `package.json`, taking 24 transitive
  `@aws-sdk`/`@smithy` packages with it. The minified server bundle drops from
  **937 KB to 450 KB**, which is the whole argument: the `BlobStorage` port is
  six methods over a five-verb subset of S3, and the SDK charged half the
  binary for it on a runtime that already has a signed S3 client compiled in.
  Nothing about the port, the config keys, the archive format, or the driver
  names changed — `[blob_storage] driver = "s3"` resolves exactly as before.
  - **`force_path_style` is inverted, not renamed.** Bun states addressing as
    `virtualHostedStyle` — the positive of the AWS SDK's option — and defaults
    it to path-style, the opposite of the SDK. An unmapped option would
    therefore have repointed every existing AWS deployment at path-style URLs,
    and Bun accepts a stray `forcePathStyle` key without complaint, so the
    mistake would have been silent. The adapter maps it explicitly
    (`virtualHostedStyle: !(forcePathStyle ?? false)`) and two tests pin the
    resulting request path in both directions.
  - **`list()` now follows continuation tokens, fixing a silent truncation.**
    `ListObjectsV2` caps a response at 1000 keys and the previous adapter
    issued exactly one, so an instance with more media than that exported a
    truncated library — `Exporter.exportDir` walks `list()` to decide which
    bytes go into the archive. This was a pre-existing bug, not a migration
    artifact; the rewrite is just where it became visible.
  - **`get()` reports the content type its key implies, matching
    `FsBlobStorage`.** Bun exposes the stored `Content-Type` only through
    `stat()`, which is a second round trip per read *and* a HEAD that a bucket
    policy granting `s3:GetObject` alone will refuse — so reading it would turn
    reads that work today into failures. Blob keys carry an extension
    (`<ulid><ext>`, D23), the fs adapter has always answered this way, and
    every caller in `Service` reads the catalog's `content_type` first and
    falls back to exactly this lookup. `close()` is now a no-op: Bun's client
    holds no pool to destroy.
  - **The SDK double is replaced by a mock S3 server.** `S3Client` has no
    `send(command)` seam, so `apps/server/test/adapters/s3-mock-server.ts` serves
    the real protocol over a real socket instead. That is an upgrade rather
    than a workaround — the old double could only prove the adapter *called*
    the SDK as expected, while the mock exercises signing, addressing, XML
    parsing and pagination, which are precisely the parts the adapter no longer
    owns and can no longer be trusted to have got right by inspection.
  - **Only this dependency was worth removing.** `tar`, `semver`, `ulidx`,
    `ajv`/`ajv-formats` and `hono` were all assessed against Bun 1.4 and kept:
    `Bun.semver` has no `validRange` and treats an unparseable range as a
    *match*, which inverts the invariant `VersionRange` exists to hold;
    `randomUUIDv7` is not a ULID and D2 is a format commitment, not a library
    choice; Bun has no JSON Schema validator; and `hono` costs 18 KB. `tar`
    could move to a devDependency once `Importer` uses `Bun.Archive` — the
    blocker is `tools/build/`, where `Bun.Archive.write` cannot set an
    executable bit and would ship a non-runnable `silo` in the release tarball.

- **`create-silo-plugin` ships (2026-08-24).** `npm create silo-plugin` (or
  `bunx create-silo-plugin`) scaffolds a plugin: the `package.json#silo`
  manifest, a runnable stub per hook the author picks, the `silo:api` type
  declarations, a tsconfig for editor support, and a README carrying the `cp`
  line and the `[[plugins]]` block to paste. It is a **standalone npm package**
  in `create-silo-plugin/` — a fourth workspace of the root — and deliberately
  **not** a `silo plugin new` subcommand: the person authoring a plugin is a
  developer who may have no silo binary at all, and the binary is a root-owned
  file on a server, so making authorship depend on the runtime is backwards. It
  changes nothing D31 froze; it emits files, reads no config and touches no
  port, which is why it needed no new decision.
  - **The value is the three things that refuse the start.** A plugin has no
    installer and no dependencies, which is a good deal that leaves exactly
    three first-time mistakes, none of which degrade: a manifest silo rejects,
    a missing `silo-api.d.ts` (the README's instruction was literally "copy this
    file by hand"), and a hook written the wrong way round — mutating after
    validation. The scaffolder removes all three by construction.
  - **Zero runtime dependencies, and Node-targeted.** `bun build --target=node`
    produces `dist/cli.js` behind a `#!/usr/bin/env node` shebang, because
    `npm create` / `npx` is Node and only Node is guaranteed to be there — so
    nothing under `src/` may reach for a `Bun.*` global. `@types/node` and
    `typescript` are devDependencies; the published package declares no
    dependencies at all, the same property it gives the plugins it emits.
  - **Every copied fact is drift-tested against the original.** The five hooks,
    the reserved driver names (`sqlite`/`fs`/`s3`), the two provider ports, the
    `Storage`/`BlobStorage` method lists and the `silo:api` `.d.ts` are all
    copies — the price of zero dependencies — and
    `apps/server/test/plugins/create-silo-plugin-drift.test.ts` asserts each against
    the file silo actually enforces. A sixth hook fails the change that adds it,
    not a stranger's scaffold months later. The test lives in silo's suite, not
    the scaffolder's, because what it protects is silo's contract.
  - **The `"silo"` range is derived, not hard-coded.** Every example in §13.2
    and the README says `"^1"`, and every one is right *about 1.0*; a plugin
    scaffolded today against a 0.2 build and pinned `^1` fails
    `silo plugin doctor` on its first run. So `SiloRange` derives it from the
    scaffolder's own version — `0.2.0` → `^0.2`, `1.4.2` → `^1` — and
    `tools/set-version.ts` now rewrites `create-silo-plugin/package.json`
    along with the others. That entry is load-bearing where `shared`/`ui` are
    inert: leave it behind on a release and every plugin created afterwards
    declares a range one version too narrow, and this gate refuses the start
    rather than degrading. `apps/server/test/version.test.ts` pins it.
  - **The generated `config` schema is extension-only.** It is one key,
    `collection`, because every hook stub opens by asking "is this the
    collection I care about?". A provider has no such question — its config is a
    bucket, an endpoint, a token — so `--config` against `--kind provider` is an
    *error* rather than a silent no-op, and the provider template says where a
    schema of the author's own goes instead.
  - **A provider scaffold is a checklist that compiles.** `Storage` has ~20
    methods and none of the domain types is published (§12.8), so every
    parameter is typed `any`, every method throws `not implemented`, and
    `ProviderPorts` carries the one sentence per method the signature cannot —
    `derived` landing in the write transaction, `listEntryCollections`
    deliberately differing from `listSchemas`. Better than a scaffold that
    returns empty lists and reads as an empty instance.
  - **It never edits anyone's `silo.toml`.** The config file is the whole
    management surface at 1.0, so the `[[plugins]]` block is *printed* and put
    in the generated README, not appended to a file the tool did not create and
    cannot safely reformat.
  - **The end-to-end test is split out on purpose.**
    `create-silo-plugin.test.ts` reads the scaffold through `ManifestReader` and
    imports the module into the host realm; `create-silo-plugin-worker.test.ts`
    loads it through `PluginRegistry` into a real `Worker`, which is what
    `serve` does. The split earned itself immediately: it was written against
    Bun 1.3.13, where `WorkerHost`'s `data:` bootstrap fails outright (see the
    Bun 1.4.0 entry below), so the worker file was red for a reason none of the
    generated code was responsible for.

- **Bun 1.4.0 across the board (2026-08-24).** `ARG BUN_VERSION` in the
  Dockerfile, `BUN_VERSION` in the release workflow, and `@types/bun` in both the
  root and `ui/` manifests — the four places the runtime is named — moved from
  1.3.14 together. The paired comments in the first two exist to prevent exactly
  the drift of bumping one: the binary users install and the image they deploy
  must not be built by different runtimes.
  - **It unblocked the plugin suite.** On 1.3.13 every worker-hosted plugin test
    failed. `WorkerHost` boots from a ~4 KB `data:` URL, and that Bun rejected
    any `data:` worker source over roughly 1 KB with `NameTooLong` — a 30-byte
    one started, so the failure was the *size*. Extension plugins therefore did
    not load at all on macOS; providers, which never reach the worker host, were
    unaffected. 1.4.0 accepts it, and `bun test` is **543 pass, 0 fail**: the 7
    pre-existing `plugins/` failures and the 3 new `create-silo-plugin-worker`
    ones all cleared on the upgrade, with no code change.
  - §13.10's timings were **not** re-taken and still read "Bun 1.3.14, win32
    x64". What was re-verified on 1.4.0 is the mechanisms, which the suite
    covers, and the section now records the `data:`-size coupling — a bootstrap
    that grows is a bootstrap to re-measure.

- **Plugins are documented in the README (2026-08-24).** M5 built the feature;
  this is what ships it. Until now `README.md` did not contain the word
  "plugin" once, which at 1.0 makes the feature unusable by anyone outside this
  repo — D31 ships **no installer**, so the entire user story is "hand-write a
  directory and list it in `silo.toml`", and that story only exists if it is
  written down. Added a `## Plugins` section (between claims and portability,
  because granting a plugin claims presumes the claim grammar), the three
  `silo plugin` subcommands in the CLI table, and a commented `[[plugins]]`
  stanza in the config reference — which `InitCommand` now writes too, matching
  §10's canonical TOML, so the array is discoverable from a fresh
  `silo init` rather than only from the spec. The Roadmap bullet that promised
  "a documented, versioned extension surface plus a published conformance
  suite" as future work was half-true after D31 and is now split: the surface
  shipped, `@silo/conformance` and the installer are what is left.
  §13.3 also claimed `@silo/plugin-types` "exists" — it does not; the types are
  `apps/server/src/plugins/host/silo-api-types.d.ts`, copied by hand, and publishing the
  package is §12.8.

- **A D7 sweep over the plugin code (2026-08-24).** D7 says "no speculative
  interfaces with zero implementations", and the first pass shipped four things
  that failed it. Removed: the **inline plugin host** and the `isolation`
  parameter threaded through `PluginRegistry.load`/`ExtensionLoadOptions` to
  reach it — nothing ever passed `"inline"`, and both of its stated consumers
  disclaim it in their own comments (`PluginLoader.loadProviders` says providers
  never go through `PluginHost`, and `plugin-hooks.test.ts` says an inline load
  would pass a plugin whose worker cannot start); `WriteContexts.Import` and
  `.Cli`, neither of which anything raised; and `"cli"` from `HookOrigin`, which
  had no producer and no reservation argument, and which the frozen `silo:api`
  types were advertising to plugin authors as a branch worth checking.
  `HookOrigin`'s `"import"` **stays** — it is reserved exactly as
  `/api/plugins/` is, so §12.8 can reach the transfer paths without changing a
  payload shape 1.0 froze. `PluginHost` also stays a port on one adapter: what
  is worth naming is the contract that spans a clone boundary, not the count of
  things implementing it. The same pass folded `ProviderRegistry`'s local
  `StorageFactory`/`BlobFactory` declarations back onto the dedicated files they
  had been shadowing — the second-source-of-truth shape that got
  `BlobStorageFactory` deleted a change earlier.

- **Plugins are in (2026-08-24, D31/§13).** Two kinds and no more:
  **providers** implement `Storage` or `BlobStorage` and run inline;
  **extension** plugins register hooks and run in a `Worker`. A plugin is a
  directory under `<data dir>/plugins/` named in an ordered `[[plugins]]` array
  in `silo.toml` — there is no installer, and `silo plugin list|info|doctor` are
  read-only and offline. Everything else plugin-shaped (an installer, HTTP
  interceptors, plugin routes, format plugins, UI contributions) is §12.8 and
  additive; `/api/plugins/*` is **reserved and returns 404** so 1.x can mount
  there without a collision.
  - **`apps/server/src/plugins/` is four submodules, one artifact per file:** `manifest/`
    reads and validates `package.json#silo` *without running anything* (so
    `silo plugin info` can show what a package wants before its code loads),
    `host/` executes plugin code behind the `PluginHost` port, `runtime/` is
    what a running plugin can see and do, and `registry/` is the single explicit
    wiring site `Cli` goes through. Import from `server/plugins` (the index),
    not from a file inside.
  - **Plugins import the host through a virtual module, `silo:api`**, and
    therefore declare **no runtime dependency on silo at all**. `SiloApi`
    registers it in the host realm and `WorkerSource` registers a matching one
    inside each worker; `silo-api-types.d.ts` is the types-only half (named so
    rather than `silo-api.d.ts` because TypeScript ignores a `.d.ts` shadowed by
    a same-named `.ts`). This is what stops every plugin carrying its own copy
    of the shared package and re-creating, once per plugin, the cross-realm
    identity problem `ValidationError.is` already exists to work around.
  - **Five hooks in `apps/server/src/core/hooks/`, dispatched by `Service`:**
    `entry.beforeValidate` (the only mutating one — it runs *before* validation
    so the schema still judges exactly what gets stored), `entry.beforeWrite`
    and `entry.beforeDelete` (veto-only), `entry.afterWrite` and
    `entry.afterDelete` (observe, best-effort, at-most-once). `Hooks` is a port
    with `NoOpHooks` as the null object, so `Service` has one dispatch path
    rather than five null checks. `Service.useHooks()` is a deliberate second
    wiring step: a plugin's context calls back into the same `Service`, so the
    two cannot both be constructed first.
  - **The transfer paths do not dispatch, on purpose.** `Importer` and
    `ScopeCopier` write through `Storage.put` directly. Left that way because an
    import must reproduce an archive faithfully — a mutating hook would make
    export→import non-idempotent and break the property D5 exists for — and
    because import already treats schema validation as opt-in (`--validate`).
    `HookOrigin` carries `"import"` already, so wiring it later changes no
    payload shape.
  - **A plugin is an API key with code attached.** It never receives `Storage`
    or `Service`; it calls `ctx.entries.*`, and every call is checked against
    the operator's granted claims with the ordinary `Claims`/`ParsedClaim`
    machinery. D31 adds **no new claim strings**. A manifest requesting a claim
    the config does not grant refuses the start, naming the claim — rather than
    surfacing later as a 403 from inside a hook on someone else's request.
  - **The `Worker` bounds faults, not malice** — it contains crashes, spins and
    memory, not a plugin reading the database. A runaway plugin is timed out,
    faulted and torn down, and is **not** restarted into the same wall on the
    next write; `apps/server/test/plugins/hostile-plugin.test.ts` pins both halves.
    The trust boundary is installing the plugin, as with npm and VS Code.
  - **Testing note that cost an afternoon:** `await expect(p).rejects` in
    `bun:test` starves the `Worker` message callback, so a dispatch that really
    answers in ~20 ms instead sits until its timeout and the assertion sees a
    `PluginTimeoutError` rather than what the plugin threw. Worker-crossing
    rejections go through the local `rejection()` helper instead.

- **The Entries page — and the search model around it — is redesigned
  (2026-08-22):** one smart search bar replaces the three fields that all said
  "search" (an instance `⌘K` trigger, an in-memory sidebar filter, and a
  per-collection search box), filters render as removable sentence chips
  instead of a count badge, every JSON Schema type has one defined table-cell
  rendering, and the long-standing cell-overlap defect's fix (2026-08-22,
  below) is now load-bearing rather than incidental. Built from a design
  handoff (`.claude/design_handoff_entries_redesign/`); ships across both the
  connected workspace shell and the settings shell, not just the Entries page,
  because the search bar's home is the top chrome on every page.
  - **`SmartSearch` (`apps/admin/src/views/search/SmartSearch.tsx`) is the one field.**
    A scope chip prefills from the page's collection (`null` off the
    workspace) and can be typed away with `@` — `MentionToken`
    (`mention-token.ts`) tokenises `@name` only at a token start (position 0
    or after whitespace), so an email in the query can never summon the
    popup, and commits by consuming the run and, when the named collection
    differs from the one on screen, navigating there with whatever text was
    left over. `ScopeMatcher` (`scope-match.ts`) ranks the popup's matches —
    collection-name hits before *field*-name hits (`orders — customer_id`),
    recency of visit (`utils/collection-visits.ts`, a `Workspace`-level
    effect that fires on every route landing, not only a mention commit)
    before alphabetical. Chip on and a `listQuery` prop (only the Entries
    page passes one) drives an in-table search exactly as before; chip off,
    or a page with nowhere to show in-table results, hands off to
    `CommandPalette` once per typing session — after that, DOM focus has
    moved into the palette's own field, so further keystrokes land there
    instead of re-seeding this one.
  - **`CommandPalette` takes a seed now**: `initialQuery` and an optional
    `reach` (`{ collection }`) that narrows its search — and skips the media
    group, which is not "inside" any one collection — instead of always
    searching the whole instance. `Workspace` and `SettingsView` each own one
    `PaletteSeed | null` and mount the palette from it; the old bare
    `showPalette` boolean and the sidebar's `⌘K` trigger button are gone; the
    chord is now caught by whichever `SmartSearch` is mounted on the page,
    and every page has one.
  - **Breadcrumbs moved out of `TopBar` and into the page body**
    (`components/Breadcrumb.tsx`, extracted from what was `TopBar`'s own
    rendering) — the top chrome is now the search bar, page-specific action
    buttons (`children`, unchanged), and the session pill. Every one of the
    ~20 views that mount `TopBar` moved with it, workspace and settings alike.
  - **Filters are chips, not a count badge** (`views/entries/FilterChips.tsx`):
    one chip per condition, read as a sentence (`title · is · "Guide"`),
    click the body to reopen `FilterBuilder` focused on that row (a
    `focusRow` prop, a subtle highlight — the panel already shows every row,
    so "focused" does not need to scroll), click `×` to drop just that
    condition. `FilterBuilder` gained a `Match [all|any] of these` header
    (`Segmented`, writing the root `and`/`or`), a type glyph per field, and
    the resolved JSONPath under each row.
  - **Ops narrow by JSON Schema type now** (`filter-fields.ts`:
    `FilterFields.valueType` reads `enum` and `format` as well as `type`;
    `FilterOpsByType` is the label table). `FilterValueType` grew `enum` and
    `date-time`; `FilterRow.op` grew a client-only `'between'` that
    `FilterModel` compiles to a `gte`+`lte` pair (there is no range op in the
    AST, and does not need to be one) and reads back as that same pair — two
    ordinary rows, not the one control it was entered with, which is a
    deliberate, documented trade: still correct, still editable, just a
    different shape after a reload. **Array fields are deliberately scoped
    down to `includes` only** — `excludes` would need `not(eq(...))` and "is
    empty" would need `not(exists(...))`, and `FilterModel`'s rows are flat
    leaves with no `not`; a `neq` on a `[*]` path does not mean "excludes"
    either (§5.3: it means *at least one* element differs). Offering a label
    the AST cannot back correctly would be worse than offering fewer labels.
    For the same reason the handoff's *"or the field is missing"* second line
    on `is not` is **not** built: it compiles to `or(not(exists(p)),
    neq(p, v))`, which nests and negates, so `fromFilter` would refuse to
    redraw it and the condition would reopen as a read-only advanced filter —
    a worse outcome than not offering it.
  - **`CellValue` now has one rendering per JSON Schema type**
    (`cell-format.ts` holds the pure shaping — `isMediaField`, `formatUri`,
    `matchBranch` for `oneOf`/`anyOf`, number formatting from `multipleOf`,
    a week-cutoff smart date). Boolean is a check glyph or a dash, never the
    word; `format: uri` drops the scheme and shows host+path with a link
    glyph; an array of objects is a count pill, never a preview; a plain
    object is `{ n keys }`, never its first field's value. `x-silo-type:
    media` resolves through a `mediaById` map the Entries page fills by
    batching `getMediaAsset` for whatever ids are on screen (never the raw
    stored `silo://media/<ulid>`) — deliberately **not** `x-silo-ref`, which
    the handoff describes but which does not exist as a schema keyword
    anywhere in this codebase yet.
  - **Extra columns are chosen, not just the first three**
    (`views/entries/columns.ts`, `ColumnsMenu.tsx`): a schema's scalar
    properties in order, capped at three by default (objects and
    arrays-of-objects excluded from the *default* but still pickable by
    hand), overridable through a new `cols` URL param
    (`ListQuery.cols`/`Routes`) so a chosen set of columns is linkable.
    Reordering is not implemented — toggling visibility is what the default
    cap needed most.
  - **The grid's fractional tracks are `minmax(0, …fr)` now**, not bare `fr`
    — a bare fractional track's minimum is its content's min-content width
    regardless of the cell's own `min-width: 0`, which is exactly the gap the
    2026-08-22 cell-overlap fix (below) did not close on its own.
  - **A self-review after the first pass caught eight defects, and one of them
    was live in the verification run.** Worth recording because most were
    invisible on screen:
    - **A filtered list re-requested itself forever.** `UrlFilter.parse`
      returns a fresh object, `parsed.filter` is a dependency of the loader
      effect, and dropping the `useMemo` it used to carry meant every response
      re-rendered, every render minted a new filter identity, and the effect
      fired again. The first verification pass captured four identical
      filtered requests and it was read as "a couple of duplicate calls"
      rather than as the runaway it was. Re-measured after the fix: **zero
      requests in five idle seconds** on a filtered view. This is the same
      identity-of-a-derived-object trap as the P3 `scope` prop — cheap to
      reintroduce, and only ever visible in the network panel.
    - **Four CSS classes were referenced and never defined** —
      `.toolbarDivider`, `.resultSummary`, `.searchStatus`,
      `.searchStatusAction`. A CSS-module miss is `className="undefined"`: no
      error, no warning, just unstyled markup that reads as a design choice.
    - **The advanced-filter pill became a `<button>` without losing the UA
      border** — there is no global button reset here, only a `font-family`
      inherit.
    - **`⌥F` never opened the sidebar filter on macOS.** Option is a compose
      modifier, so the event arrives as `key: "ƒ"`; the check now reads
      `e.code === "KeyF"`.
    - **The instance overlay opened once and then never again** — the
      once-per-session latch was never released when the palette closed, so a
      second search silently did nothing until the field was cleared. Released
      on refocus now.
    - **Walking from a searched list to a settings page popped the overlay by
      itself**: the bar kept its text, the new page had no in-table search to
      hand it to, and the settle timer treated that as "search everywhere".
      Navigation now resets the bar to whatever the page it landed on says.
    - **Escape while the `@` popup was open blurred the whole field**, because
      the popup's own handler and the window-level one both ran.
    - **The columns picker accepted a seventh column** that `Columns.parse`
      then dropped on the next load; the cap is enforced in both places now.
    Also: the access badge was rendering a status dot *and* a lock/globe
    glyph (the design canvas draws the glyph alone), the engine tag was stated
    twice on one screen, `@`-mention removal left a double space mid-sentence,
    and five now-dead rules were still in `Entries.module.css`.
  - Split for size along the way: `use-entries-data.ts` (the loader,
    ticketed exactly as before), `EntriesTable.tsx` (header/rows/empty
    state), `DeleteEntryModal.tsx` — `Entries.tsx` was 565 lines and doing
    substantially more before this.
  - Tests: `mention-token.test.ts` (token-start rule, one-chip-at-the-caret,
    consume), `scope-match.test.ts` (name-before-field ranking, recency),
    `filter-model.test.ts` gained the `between` compile/decompile pair,
    `routes.test.ts` gained `cols`. 508 pass across the repo (`bun test`),
    `tsc -b` and `oxlint`/`stylelint` clean.
  - Verified end-to-end against a live server seeded with ~5,000 entries
    (`tools/seed/main.ts`): `@`-mention navigation across collections and
    projects, the instance overlay opening mid-type with cross-scope
    grouping, a `between` filter compiling to the exact `gte`/`lte` pair and
    reopening as two chips, the Columns picker adding a live column and
    writing `cols=`, boolean/uri/date/number/array-of-string cell rendering,
    and the settings shell's pages (Keys, a project's General page) with
    their own smart bar and breadcrumb.

- **There is a data seeder now (2026-08-22):** `tools/seed/main.ts`, one file, run
  with `bun run tools/seed/main.ts --key "$SILO_KEY"`. It writes ~5,000 entries
  across 2 projects × 3 environments (`dev`/`uat`/`prod`), 5–20 collections per
  environment drawn from a 24-blueprint catalogue, 20–100 entries each — the
  size at which paging, ranking and the scope switchers behave like they do for
  a real user, and which nobody reaches by hand.
  - **It speaks the HTTP API and imports nothing from this repo.** That is what
    "self-contained" buys: it runs against any reachable instance, and it
    exercises the same validation, media-reference and index paths a client
    does instead of a private back door into `Storage`. It is also why one file
    holds a dozen classes against the one-artifact-per-file rule below — a
    seeder you cannot copy on its own is not self-contained. Deliberate, and
    limited to this file.
  - **A collection's schema and its entries come from one field list.** Each
    blueprint is a list of `FieldSpec`s; `SchemaFactory` derives the JSON
    Schema (including `x-silo-search` labels and exclusions, and `x-silo-auth`
    on the four private collections) and `ValueFactory` derives values from the
    *same* list. Two hand-written halves drift the first time a field changes,
    and the drift arrives as a `400` several hundred entries into a run.
  - **`--seed` alone was not reproducible, and the gap was invisible.** Two
    instances seeded from one seed compared byte for byte differed only in date
    fields: generation read `Date.now()`. Dates now come from a `Calendar` over
    an explicit `--epoch` (default now, printed on every run as the pair that
    reproduces it), and the same seed and epoch produce an identical corpus at
    any concurrency — verified across two instances at `--concurrency 8` and
    `3`. What stays non-deterministic is the order writes land in, and so which
    entry gets which id and `created_at`.
  - **Refusals, not partial runs:** a `4xx` stops the run with the server's own
    message, because thousands of quietly skipped entries under a summary that
    claims success is the worse failure; `5xx` and connection errors retry.
    Preflight checks health and `/api/session` before the first write, and a
    non-localhost URL needs `--yes`.
  - Verified on a live instance: 4,979 entries stored against a plan of 4,979,
    `engine=fts5` search across scopes, `cafe` → `[Café]` and a CJK term both
    matching, an excluded field never appearing in a snippet, `x-silo-auth`
    collections `401`-ing anonymously while public ones serve, and a filtered
    and sorted list query over the seeded rows. 488 tests still pass.

- **A long cell no longer paints over the column beside it (2026-08-22):**
  `.cell` in `apps/admin/src/components/DataTable.module.css` could shrink
  (`min-width: 0`) but nothing clipped what overflowed it, so a long string in
  an entries column ran across the ones next to it — the body column over
  views and draft. The cells that looked right were the ones inside
  `.primary`: `.title`/`.subtitle` are flex items, so their own
  `overflow: hidden` applied. `CellValue`'s `.text` is an inline span, where
  `overflow` does nothing at all and only its `white-space: nowrap` took
  effect — which is exactly what pushed the line past the column edge. The
  shared primitive truncates now (`overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap`), so every table built on it gets one line ending in an
  ellipsis. Two consumers opt back out where they mean to: the entries
  empty-state message (`.noResults`) borrows `.cell` for its padding but is a
  paragraph, so it restores `white-space: normal`; the keys table's `.label`
  truncates itself, because `.cell`'s ellipsis belongs to its block box and
  not to a flex item inside `.labelCell`. Wrapping chips (`CellValue`'s
  `.tags`) are untouched — `white-space` does not govern flex line breaking —
  and the entries row menu hangs off `.actions`, not `.cell`, so nothing clips
  it. Pre-existing; older than the P3 search work, and left out of it because
  it is shared by every table.

- **The admin UI reads search now (2026-08-21):** P3 of **D30**, and the last
  of it. Collection search with snippets, a `⌘K` instance-wide palette, and a
  filter builder over the path AST (§9, views 2 and 3).
  - **The entries view searches instead of pretending to.** Typing used to
    compile a `contains` on whichever column looked like a title, so a word in
    a body was unfindable and a collection without a string field could not be
    searched at all. It now calls the collection-reach `/search`, shows the
    snippets that say *which field* matched, and states the engine that
    answered — `fts5` or `scan`, the same badge on both.
  - **A snippet is three strings now, not one with markers in it.** The wire
    shape changed from `text: "…our [pricing] page…"` to `{ before, match,
    after }`. P3 was its first consumer and the reason: the very first fixture
    with a markdown link — `See [our docs](https://silo.dev) — the new pricing
    page` — would have highlighted *our docs* for a search for `pricing`,
    because a highlighter reading in-band brackets cannot tell the engine's
    pair from the content's. Verified in a live run that the highlight now
    lands on `pricing`. §5.5 and D30 record it; both engines and every
    assertion moved with it.
  - **An absent `sort` in the URL means nobody chose one.** `ListQuery.sort` is
    `string | null`, and the router writes nothing for the default. Without
    that distinction the view would always send a sort, §5.5 would honour it,
    and relevance ranking would be unreachable from the UI that asked for it.
    Sort, text, filter and page all live in the URL, so any view is linkable.
  - **The filter builder writes the Query AST (D29).** Fields come from the
    schema (an `array` property is offered as `$.data.tags[*]`, since a path to
    the array itself compares against the whole list and matches nothing), the
    value type comes from the property's JSON Schema type — so `views ≥ 500`
    sends `500` and not `"500"` — and the ops come from **`@silo/shared`**:
    `Filter` and `FilterOps` moved there beside the path parser, because a menu
    offering an op the validator refuses is a `400` the reader cannot act on.
  - **What the builder cannot draw, it refuses to redraw.** A nested or
    hand-written filter is shown read-only and still applied, rather than
    silently simplified into the flat shape (`FilterModel.fromFilter` → `null`).
    And an unreadable `?filter=` refuses to list anything instead of dropping
    the filter — dropping it widens the page to everything while the URL still
    claims to be filtered, which is the one failure direction that misleads
    rather than interrupts.
  - **`⌘K` searches the whole instance**, not the scope on screen, because the
    key already bounds it: `searchAccess` compiles the caller's `entries:read`
    claims, so asking for everything returns exactly what that key can see.
    Verified with a key holding one collection claim: the palette showed that
    collection and nothing else — no other scope, no media group.
  - **Media is merged in the UI and nowhere else.** The server keeps it out of
    the entry index (its own `media:*` claims, D23/D24); the palette adds it as
    a separate group and links each asset by the search that found it, since
    the library has no per-asset URL.
  - **Two defects found by running it, not by testing it.** Every collection
    search fired **twice** per load — the effect depended on the `scope` prop's
    identity, which the parent rebuilds on every render. And `Escape` closed
    the palette only while focus stayed inside it, unlike every other overlay
    in the shell. Both fixed.
  - Tests: `apps/admin/src/query/filter-model.test.ts` (16 — both directions of the
    AST round trip, including the five shapes the builder refuses),
    `path-label.test.ts` (`$.database` must not shorten to `base`),
    `views/search/palette-results.test.ts` (grouping, cross-scope links, media
    as its own group), `snippet-view.test.ts`, and the list-URL grammar in
    `router/routes.test.ts`. 488 pass.
  - Verified on a running server across both engines: snippets and their field
    paths, `x-silo-search` exclusion (an excluded note never appears in a
    snippet), relevance order and an explicit sort overriding it, the filter
    builder's typed values, a `not(...)` filter shown as advanced and still
    applied, an unreadable filter refusing to list, cross-scope navigation out
    of the palette, media landing on the library pre-searched, and the `scan`
    badge with search switched off.

- **The FTS5 engine, and the port change that feeds it (2026-08-21):** P2 of
  **D30**. `SqliteSearcher` matches and ranks in SQL; `ScanSearcher` stays the
  fallback. Both face the *same* API suite — `search-api.test.ts` runs twice,
  once per engine — which is the parity contract made executable.
  - **`Storage.put(e, { usages, search })`.** The port change D30 deferred out
    of P1 lands here, with the engine that stores the text. Both adapters, all
    call sites and the conformance suite moved; the fs adapter ignores
    `search` for the reason it ignores usages (D5, and an index that goes stale
    under a `git checkout`).
  - **`entry_search_documents` + `entry_search_fts`** (external content, three
    sync triggers), written **inside** `put`/`delete`/`deleteProject`/
    `deleteEnvironment`'s existing transactions. `docid` is an explicit
    `INTEGER PRIMARY KEY`: `VACUUM` renumbers the implicit rowid of a
    composite-PK table, which would point the index at the wrong rows without
    a single error. The upsert is `ON CONFLICT DO UPDATE`, so it survives a
    rewrite.
  - **The external-content trap is closed and pinned.** Update and delete
    triggers use FTS5's documented `'delete'` command with `old.*`, or terms
    for text that no longer exists keep matching. Verified on a live server:
    renaming an entry stopped it matching its old title.
  - **FTS5 is probed, never assumed** — Bun links a different SQLite per
    platform and the shipped build sets `OMIT_LOAD_EXTENSION`, so a build
    without it cannot be repaired, only degraded from. `createSearcher()`
    returns null and `Service` falls back to the portable engine.
  - **Opening with search disabled drops nothing** — it clears the version
    stamp instead. This was a real bug found in a live run: every CLI
    subcommand opens the store, so `silo keys list` from a build without FTS5
    would have deleted the index a running server was maintaining on the same
    data dir. A cleared stamp already forces the rebuild correctness needs.
  - **The stamp covers engine, extractor and tokenizer.** The tokenizer is
    fixed into the virtual table at creation, so changing it is a rebuild —
    which runs **before the bind**, because a half-filled index answers with a
    subset and nothing says so.
  - **Snippets come from the shared builder on both engines**, not FTS5's
    `snippet()`. Only two concatenated columns are indexed, so `snippet()`
    could not name the field a match came from; re-extracting over one page
    removes an engine difference rather than adding one.
  - **`[search]` config** (`enabled`, `tokenizer`, `max_entry_bytes`,
    `scan_limit`, `scan_time_budget_ms`), in `silo init`'s scaffold, with
    `SILO_SEARCH_ENABLED` / `SILO_SEARCH_TOKENIZER` overrides.
    **`silo search reindex [--check]`** and `POST /api/search/reindex` rebuild
    and validate; the route asks for the instance-wide read authority an export
    does, since a rebuild reads every entry.
  - **Two integrity checks, because one is not enough.** FTS5's built-in check
    compares the index to its content table and is blind to a document whose
    entry has gone — the second anti-join catches that in both directions.
  - Verified on a running server: `engine=fts5`, label-weighted ranking,
    diacritic folding (`cafe` → `[Café]`), `x-silo-search` exclusion, FTS5
    operator words searched for rather than obeyed, stale-term removal on
    update, trigram substring search after a tokenizer change, and the scan
    fallback when disabled. 450 tests pass.

- **Search works on every adapter, before FTS5 exists (2026-08-21):** P1 of
  **D30** (§5.5). A `Searcher` port with one implementation so far —
  `ScanSearcher`, which reads entries through `Storage` and matches in memory,
  so it answers on SQLite and fs alike and will answer on any future adapter.
  FTS5 is P2 and makes this *fast*, not *possible*.
  - **Three reaches, addressed by path** (D19): `GET` on
    `/api/projects/{p}/envs/{e}/collections/{name}/search`,
    `/api/projects/{p}/envs/{e}/search`, and `/api/search`. `GET` is the only
    method — see D30 for why `POST` was specified and then dropped. The routes
    register **before** `EntriesRoutes`, or `/collections/{name}/search` is
    captured as an entry whose id is `"search"`.
  - **Authorization is a compiled plan, not a claim string.**
    `Service.searchAccess` turns a key's `entries:read` claims into concrete
    `SearchTarget`s, intersected with the reach the route took from its path —
    a `*` claim narrows *to* the reach instead of escaping it — and the engine
    applies them before rank, count and paging, so `total` and every page
    boundary are right rather than post-filtered. An unparseable stored claim
    is skipped, not thrown: one bad record must not 500 every search.
  - **Anonymous search reaches public collections only**, and a collection
    with **no schema** is not public — an import archive can carry entries with
    no schema, and nobody declared those readable.
  - **`x-silo-search`** (`packages/shared/src/schema/search-fields.ts`) selects the
    corpus with D29 paths: `label` weights, `include` replaces the default,
    `exclude` subtracts a subtree. Validated on schema save, so a mistyped path
    is a `400` instead of a field that quietly stops being searchable. It is
    **not** an access control — an excluded field is still returned on read,
    and there is a test that says so.
  - **What is indexed by default:** every string and number leaf under
    `$.data`. Not field names (a search for "title" would match everything),
    not booleans or nulls, not `silo://media/...` references, and not past a
    byte cap.
  - **The tokenizer is pinned to measured FTS5 behaviour**, not to a
    description of it: `apps/server/test/core/search-tokens.test.ts` holds fixtures
    read out of SQLite with `fts5vocab` — `foo_bar` splits on the underscore, a
    ULID stays one token, a URL splits into seven, `Café` folds to `cafe`, and
    `日本語のテキスト` is **one** token. P2's engine has a target to match
    rather than prose to interpret. Snippets fold to match but quote the
    original, so a search for `cafe` returns `[Café]`.
  - **The scan is bounded and says so.** A visit cap *and* a time budget, both
    checked per entry — at page granularity one page overruns the cap by its
    whole size, which a conformance test now pins. `truncated: true` means
    `total` counts what was examined.
  - **The port change is deliberately not here.** `Storage.put(e, { usages,
    search })` lands in P2 with the engine that stores the text; `ScanSearcher`
    extracts at query time, and a required argument every caller computes and
    every adapter ignores is the speculative interface D7 rejects. D30 and §5.5
    were corrected to say this.
  - `EntryNodes` (`apps/server/src/core/query/entry-nodes.ts`) now owns in-memory path
    selection and value ordering — `FsFilter` and `ScanSearcher` both needed
    it, and a second copy would be a second definition of what a path selects.
  - Tests: `search-tokens.test.ts` (parity fixtures), `search-text.test.ts`
    (corpus, `x-silo-search`, keyword validation), `http/search-api.test.ts`
    (20 tests — reaches, claim boundaries, anonymous, snippets, filters, sort,
    paging, rejections), plus a portable-engine section in the storage
    conformance suite that runs on **both** adapters. 407 pass.
  - Still to come in P2: the FTS5 engine, the port change, `silo search
    reindex`, and a `[search]` config block — the scan caps are constants on
    `ScanSearcher` today.

- **Queries address entries with JSONPath now, and `contains` means one thing
  (2026-08-21):** filter and sort fields were a private dot-grammar
  (`author.name`, `$id`) that every client had to learn. They are RFC 9535
  paths over a virtual entry document — `{ id, rev, created_at, updated_at,
  data }` — parsed once in `packages/shared/src/query/path/` and read by the UI, the
  validator, the SQL compiler and the in-memory evaluator (**D29**, §5.3).
  `Filter.field` is now `Filter.path`, and `SortKey.field` is `SortKey.path`.
  This is P0 of the search work (**D30**, §5.5); nothing of the `Searcher` port
  exists yet.
  - **The subset is closed and refused by name.** Root, name selector, array
    index (negative included) and the child wildcard are in. Recursive descent,
    slices, index unions, filter selectors and function extensions each raise a
    `400` that names the construct — a selector that parsed and was then
    dropped would answer a different question and return a wrong result, which
    no test written with well-formed paths would catch.
  - **`project`, `env`, `collection` and `seq` are unaddressable**, derived
    from §5.1 hiding them rather than from a second allow-list. `$.seq` returns
    "not part of the entry document" and names what is addressable.
  - **ANY over zero nodes is false, for every op.** A leaf is true when any
    selected node satisfies it, so `neq` on a *missing* field returned true
    before and returns false now; "absent, or not equal" is
    `or(not(exists(p)), neq(p, v))`. `not` compiles to `NOT COALESCE(cond, 0)`
    and never a bare `NOT` — SQL three-valued logic drops NULL rows, so a bare
    negation disagreed with the fs adapter on exactly the missing fields a
    negation is usually asked about (measured: 0 rows vs 2).
  - **`contains` is substring-on-a-string only.** Array membership is `eq` over
    `$.data.tags[*]`, which deleted the `json_type(...) = 'array'` CASE from
    the SQL compiler and the array branch from `FsFilter`. `Service.listMedia`
    moved its tag filter accordingly — and stopped matching "newsletter" for a
    search of "news" as a side effect. A wildcard selects children of an array
    or object and never a scalar, on both adapters.
  - **`exists` and `not` joined the op set**; leaf values are now required to
    be scalars, because an object has no consistent answer (the evaluator
    compares by reference and says false; SQLite cannot bind it at all).
  - **This is an API break with no shim and no detection**, per the pre-1.0
    stance D18 set. `?filter={"field":...}` and `sort=-$updated_at` return
    `400`. The admin UI ships in the same binary (D13) and moved with it; the
    one thing that outlives a binary is a *bookmarked* list URL, so
    `Routes.decodeQuery` maps an old sort key to a path client-side — the
    server stays clean, and shared links keep working.
  - `shared/test/json-path.test.ts` (17 tests) pins the subset and every
    refusal; the storage conformance suite pins the semantics on **both**
    adapters, including the wildcard, the negative index, nested wildcards,
    presence, and that `neq` no longer matches a missing field;
    `apps/server/test/http/entries-api.test.ts` pins the wire behaviour and the
    rejections.
  - **Two things this turned up.** `entries-api.test.ts` built a bare `Hono`
    instead of `SiloServer`, so it had no `onError` and reported every rejected
    query as a `500` — it now builds the app the way every other HTTP test
    does. And a new directory under `packages/shared/src/` needs `bun install` before
    the UI can import it: the workspace link mirrors `shared/src` as real
    directories with per-file symlinks, frozen at install time.

- **The version has one home now: the root `package.json` (2026-08-21):** it
  had four — `package.json`, `shared/package.json`, the literal in `Cli`, and
  the fallback in `Exporter` — plus `ui/package.json`, which had quietly sat at
  `0.0.0` since the project began and was found by the test written to check
  exactly this. `bun run set-version 0.2.0` now moves every one of them
  (**D28**).
  - **`apps/server/src/version.ts` imports the manifest rather than restating it**, which
    is what deletes the copies instead of adding a rule about keeping them in
    step. `bun build --compile` bundles the JSON, so a binary reports the right
    version from any working directory with no file to read and no build flag
    required — verified from source, compiled, and compiled with the define.
  - **`-dev` survives on purpose.** `SILO_VERSION` no longer supplies the
    version, only the fact that this build is a *release*: a release passes the
    tag it was cut from, everything else appends `-dev`. Collapsing both onto
    one number would lose the distinction that matters most often — whether a
    binary is the published artifact or something built on a laptop — which is
    how a bug report ends up filed against the wrong one.
  - **The release refuses a tag that disagrees with the manifest**, naming the
    command that fixes it. A `workflow_dispatch` rehearsal only warns, because
    building a version the tree does not declare is the point of a rehearsal.
    Exercised locally against a matching tag, a mismatched tag, a mismatched
    dispatch, and a non-semver tag.
  - `set-version` rewrites the `version` field by text rather than reparsing:
    `JSON.parse` then `JSON.stringify` preserves key order but not indentation
    or the trailing newline, and a version bump that reflows three manifests is
    a version bump nobody can review. It commits and tags nothing — staging in
    this repo is the author's.

- **`dnf install silo` works on Amazon Linux 2023, and the release now
  publishes a signed yum repository (2026-08-21):** Homebrew covers laptops;
  the machines silo actually runs on are EC2 instances, and there was nothing
  for them but a tarball. A `rpm` job now builds a signed RPM per architecture
  with [nfpm](https://nfpm.goreleaser.com/) (`packaging/rpm/nfpm.yaml`,
  `tools/build-rpm.ts`), and a `dnf-repo` job indexes the last
  `DNF_REPO_RELEASES` releases with `createrepo_c` and publishes the result to
  GitHub Pages (**D27**).
  - **One RPM covers the whole RHEL family, and that is a measured claim.** The
    released Linux binary references no symbol newer than `GLIBC_2.17` and links
    no libstdc++ — Bun statically links nearly everything — while AL2023 ships
    glibc 2.34. So the package is built per architecture, not per distribution,
    and the same file installs on RHEL 8/9 and Fedora.
  - **It is a service package, not a binary drop.** A `silo` system user,
    `/etc/silo/silo.toml` marked `config|noreplace`, `/var/lib/silo` at
    `silo:silo 0750`, and a systemd unit. `%post` runs `systemctl preset` rather
    than `enable`, which on RHEL-family hosts leaves the unit **off** — a
    package manager must not open a port on a host nobody has configured yet —
    so installing prints how to start it and where the one-time root key will
    appear (`journalctl -u silo`).
  - **The unit sets `MemoryDenyWriteExecute=false` explicitly.** It is the
    obvious next line of hardening to add to a unit that already has a dozen
    `Protect*` directives, and it stops silo from starting at all: Bun's engine
    JITs, which means mapping pages writable and then executable. Absent, the
    setting invites someone to add it; present and commented, it does not.
  - **nfpm expands environment variables in scalar fields but not in content
    globs** — `src: ${SILO_BINARY}` made it search for a directory of that
    literal name. `build-rpm.ts` stages the binary at the fixed path the config
    names instead, which is also where the executable bit is restored: a CI
    artifact round trip loses it.
  - **Pages holds no state.** Every deploy replaces the whole site, and the
    packages it serves are downloaded back out of recent GitHub releases — the
    release assets are the durable copy, the repository is a derived index.
    That is what keeps Pages' 1 GB soft limit from becoming an unwritten
    retention policy at ~60 MB of RPMs per release, and it means the index can
    be rebuilt from scratch at any time. A release cut before dnf support has no
    RPMs to download, which is tolerated; an *empty* index is not, and fails the
    job.
  - **Both signatures are checked, and the second is the one that matters
    less obviously.** `gpgcheck` verifies each package; `repo_gpgcheck` verifies
    the index that lists them. Without the latter, whoever serves the index
    still chooses which signed packages you are offered — including an old one
    with a known bug. This is the apt/rpm use the release key was chosen for
    (D26): RSA-4096 precisely so the oldest verifier in the family can read it.
  - Verified before shipping: RPMs built locally and their headers parsed
    directly — ownership, modes, `config|noreplace` (file flags 17), all four
    scriptlets, and `Requires: shadow-utils` for the `useradd` in `%pre`; the
    signed and unsigned builds differ by exactly the `RSAHEADER`/`PGP` signature
    tags. CI goes further and does the real thing: `dnf install` inside an
    `amazonlinux:2023` container, running silo as the packaged user, then
    `dnf remove` and an assertion that `/var/lib/silo` survives it. The
    `dnf-repo` job repeats it against the assembled index over `file://` with
    both gpg checks on, before anything is published.
  - **Two rounds of that container test were wrong, and neither was the
    package's fault** — the `v0.2.0` run reached it twice with the RPM itself
    verifying, installing, and reporting the right version each time. First
    `runuser` is absent from the minimal `amazonlinux:2023` image, so the step
    now installs `util-linux` as test scaffolding, commented as such: nothing
    silo needs arrives any way but through the RPM's own `Requires`. Then
    `silo status` was asserted to succeed on a data directory with no server —
    the exact opposite of its contract, which is to **exit non-zero so a shell
    can branch on it**, the way `systemctl status` does. The test now asserts
    the failure, and does the check that was actually wanted alongside it: the
    silo user mints a key through `/etc/silo/silo.toml`, which passes only if
    the packaged config is readable at `0640 root:silo` by a member of that
    group and the packaged data directory is writable. `silo status` never
    touched either.

- **silo is installable — `brew install org-quicko/tap/silo` — and a release is
  one tag push (2026-08-21):** there was no CI, no tag, and no artifact anyone
  could install; `bun run build` produced a binary for the machine that ran it
  and nothing carried it further. `.github/workflows/release.yml` now builds
  four targets on a `v*` tag, checksums them, signs the checksum file twice,
  publishes the release, and rewrites the formula in `org-quicko/homebrew-tap`.
  The runbook and key setup live in Notion (moved 2026-08-21 — package
  managers accumulate, and a per-manager doc belongs somewhere that isn't a
  code review); `packaging/` in this repo now holds only what CI reads:
  `homebrew/silo.rb.tmpl` and the public half of the signing key.
  - **The compiled binary had to start carrying the admin UI first, and that was
    the real blocker.** `SiloServer` served `./ui/dist` *relative to the working
    directory*, so a `silo` on `$PATH` answered every UI route with "Admin UI
    not built" unless the user happened to be standing in a source checkout.
    `UiAssets` (`apps/server/src/http/ui-assets.ts`) now brokers it: a release build hands
    it a route→path map through `useEmbedded`, everything else reads the
    directory as before. IMPLEMENTATION.md §9 had claimed a self-contained
    binary since the Go era; this is the first build for which it is true.
  - **The embedding is generated, not written.** `tools/build/` emits
    `.build/entry.ts` — a `with { type: "file" }` import per file in `apps/admin/dist`,
    the map, then `Cli.run()` — and compiles *that* instead of `apps/server/src/main.ts`.
    Those imports survive `--compile` as `/$bunfs/root/…` paths that `Bun.file`
    reads from any cwd (verified: 200s and byte-exact bodies with correct MIME
    from a binary run out of `/private/tmp`). The names are content-hashed, so
    something has to hold the map; and the entry cannot be `apps/server/src/main.ts`,
    which calls `Cli.run()` on import and would start the server before there
    was anything to hand it.
  - **`bun run build` is now the only build path.** Same script, same flags:
    `--target`, `--version`, `--out`, `--archive`, `--skip-ui`. A release
    artifact is reproducible locally, and CI runs nothing that a developer
    cannot. The version stops being the `0.1.0-dev` literal in `Cli` — a release
    passes `--define SILO_VERSION='"1.2.3"'` and `typeof` picks the fallback
    everywhere else, which is what lets Homebrew's `test do` assert on it.
  - **Both Darwin targets are built on the macOS runner because `codesign` only
    exists there.** Cross-compiling the x64 half from the arm64 runner is fine —
    `codesign` signs a foreign-arch Mach-O quite happily, measured — and this
    sidesteps the retirement of the Intel `macos-13` image entirely. What cannot
    move is the signing: an unsigned arm64 Mach-O is not slow or warned about,
    it is SIGKILLed at exec.
  - **`compiled-detach.test.ts` was failing on macOS arm64 before any of this,
    for exactly that reason** — it compiles a binary and never signed it, so
    every assertion in it died behind a bare exit code 137. It now applies the
    same ad-hoc sign the build does. It is the one other place in the repo that
    compiles, which is why it is the one other place that has to.
  - **Signing is two signatures over one checksum file, not one per artifact.**
    Sigstore keyless (`SHA256SUMS.cosign.bundle`) means no private key exists in
    the repository at all — the identity is the workflow's OIDC token — and a
    GPG detached signature (`SHA256SUMS.asc`) is there for verifiers that want a
    fingerprint to pin, and because apt and rpm will both need that key later.
    Neither can be Apple's or Microsoft's: those trust only certificates they
    issued, which is the one thing a "common signing key" cannot span. The
    Darwin builds stay ad-hoc signed, which is sufficient for Homebrew — a
    formula's tarball comes down over curl and is never quarantined.
  - The GPG step warns and skips when `GPG_PRIVATE_KEY` is unset, so the first
    release can precede the key. `HOMEBREW_TAP_TOKEN` has no such fallback: the
    tap is another repository and `GITHUB_TOKEN` cannot write to one.
  - **The first tag pushed, `v0.1.0`, failed at the last step: `gh` could not
    tell which repository it was releasing into.** Every job before it passed —
    four artifacts built, checksummed, and signed both ways — and then
    `gh release create` exited on `failed to run git: fatal: not a git
    repository`. The release job deliberately checks nothing out, having no work
    for a source tree, and `gh` falls back to reading the repository off a git
    remote for commands that "otherwise operate on a local repository". It now
    passes `GH_REPO: ${{ github.repository }}` instead, which is the documented
    way to say so; cloning the repo to let `gh` read a remote URL back out of it
    would be the other fix and a worse one. Reproduced outside a git directory
    before and after, against the real `gh`.
    - **A re-run will not pick this up.** GitHub runs a workflow from the file
      at the commit being built, so the fix has to be committed and the `v0.1.0`
      tag moved onto it (or a fresh tag cut) — re-running the failed job replays
      the broken file.
  - **The actions were pinned at majors that target Node 20**, which GitHub has
    been force-running on Node 24 since the September 2025 deprecation and will
    eventually stop accommodating: `checkout` v4→v7, `upload-artifact` v4→v7,
    `download-artifact` v4→v8, `attest-build-provenance` v2→v4. Every input the
    workflow passes was checked against the new majors first — `merge-multiple`,
    `pattern`, `subject-path`, `if-no-files-found` all survive. `setup-bun@v2`
    and `cosign-installer@v3` were never flagged and stay put: the first already
    resolves to a Node 24 build, the second is a composite action with no Node
    runtime of its own.

- **`serve --detach` worked from source and failed from the compiled binary
  (2026-08-21):** every detached start of a built `silo` died instantly with
  `unknown command "B:/~BUN/root/silo"`, its usage dump landing in the log file.
  `Daemon.relaunchArgs` forwards argv[1] to the child because under `bun run`
  that is the entry script and the child needs it; a compiled binary's argv[1]
  is instead a path inside Bun's virtual filesystem, and the child already has
  its own, so the forwarded copy arrived as argv[2] — where the CLI, reading
  `argv.slice(2)`, took it for a subcommand. The guard meant to separate the two
  tested `fs.existsSync(argv[1])`, which **answers `true` inside a compiled
  binary** (so does `statSync`): Bun serves the virtual path from the embedded
  filesystem. It now resolves the path instead — `fs.realpathSync` throws
  `ENOENT` there and succeeds from source — which keeps the check independent of
  how Bun spells its virtual root, the property the original was reaching for.
  - **From source the bug is invisible, and that is why it shipped.** Outside a
    compiled binary `B:/~BUN/root/silo` is absent from the filesystem, so the
    broken check and the correct one return the same answer; the existing
    `detached-serve.test.ts` round trip runs the entry script and passed
    throughout. `apps/server/test/runtime/compiled-detach.test.ts` closes that by
    doing the only thing that reaches it: `bun build --compile` into a temp dir,
    then a real detached start, stop, and an assertion that the log holds no
    usage dump. It costs about 1.4s and a ~100 MB temporary file, which is why
    it is one test — and it was confirmed to fail against the old check rather
    than merely pass against the new one.
  - `Daemon.relaunchArgs` is now public and takes `(argv, execPath)` with the
    process values as defaults, so `relaunch-args.test.ts` can exercise the argv
    shaping directly. That suite deliberately does not assert on the virtual
    path: such a test passes with the bug present, which is worse than no test.
  - This is a Bun behavior the fix depends on, not a specification. If a future
    Bun resolves virtual paths through `realpathSync`, the discriminator goes
    quiet again — the compiled test is the thing that would notice.

- **`bun run build` is platform agnostic (2026-08-21):** the root build script
  was `bun build … --compile --outfile silo && codesign -s - silo`, and the
  second half is macOS-only — on Windows and Linux `codesign` does not exist, so
  the script always exited non-zero *after* having produced a perfectly good
  binary. The compile is now `tools/build/` (`BuildBinary`), which runs the
  same compile and applies `codesign` only when `process.platform === "darwin"`.
  - **The signing is not incidental on macOS and could not simply be dropped.**
    `--compile` appends its payload to a copy of the Bun executable, which
    invalidates the signature that Mach-O shipped with, and macOS refuses to
    run a binary whose signature does not match — so the ad-hoc re-sign is what
    makes the artifact runnable there. Nothing to do on the other platforms;
    they run the compiled file as it lands.
  - The re-sign now passes `--force`, which replaces an existing signature
    instead of failing on one. Without it the step is only correct while Bun
    leaves its output unsigned, and that is a Bun implementation detail, not a
    guarantee.
  - **The output name needs no branching:** Bun writes `silo.exe` on Windows
    from `--outfile silo` on its own. The script derives the artifact path the
    same way, for the signing target and the size it reports, and `/silo.exe`
    joins `/silo` in `.gitignore`. Verified on Windows: build exits 0 and
    `./silo.exe --help` runs.

- **`ui/` is a Bun workspace of the root, not its own install root
  (2026-08-21):** adding `packages/shared/src/media/media-ref.ts` broke `bun run build`
  in `ui/` with an unresolved import of `@silo/shared/media-ref`, while `tsc -b`
  in the same script passed. The cause was the `file:../shared` protocol: Bun
  mirrors such a dependency as **per-file** symlinks taken at install time, so
  the UI's copy had `src/{claims,errors,keys,schema}` and no `src/media` at all,
  and the package's own `exports` map pointed at a file that was not there. The
  root `package.json` now declares `"workspaces": ["shared", "ui"]` and `ui`
  depends on `@silo/shared` via `workspace:*`, which symlinks the directory
  itself — one entry, `node_modules/@silo/shared -> ../../shared` — so a file
  added under `packages/shared/src/` resolves from every member with no reinstall.
  `ui/bun.lock` is deleted; the root lockfile is now the only one.
  - **The failure was invisible to `tsc` by construction.** TypeScript follows
    the symlink to the package's real path and type-checks against the true
    source tree, so a subpath missing only from the mirror still type-checks;
    the bundler resolves the mirror and does not. Any check that runs before
    the bundle — `tsc -b`, `oxlint` — will stay green through this class of
    breakage, which is why `bun run build` was the first thing to notice.
  - **Bun aborts the install if a declared member is absent**, with
    `error: Workspace not found "ui"`. That governs the Dockerfile: both stages
    now install from the workspace root with every member's manifest copied in,
    and the runtime stage copies `ui/package.json` for no other reason.
    `--filter '!silo-ui'` there keeps the UI's dependencies (React, Vite,
    CodeMirror) out of the runtime image, which otherwise grows from 25 MB of
    `node_modules` to 95 MB for packages the server never imports — it serves
    `apps/admin/dist` as static files. Stage 1 inverts the filter (`--filter silo-ui`)
    and skips the server's tree instead.
  - Hoisting does not flatten the pinned versions apart: root and `ui` disagree
    on TypeScript (7.x vs `~6.0.3`) and on `@types/node`, and Bun nests each
    member's own copy, so `bun run --cwd ui build` still compiles on
    TypeScript 6. Verified after the change: the full `bun test` suite passes,
    both type-check targets are clean, and the UI bundle hashes identically to
    the pre-change build.

- **A running server names itself `silo` in the process list (2026-08-21):**
  a detached server was named after whatever binary was executing it, so a
  source deployment showed up in `ps` and `top` as `bun`, and finding silo
  meant recognising it by its arguments. Every `serve` now sets its process
  title to `silo <listen>` (`ProcessTitle`, `apps/server/src/runtime/`), immediately
  after the bind and for the same reason the run file is written there — a
  start that lost the port race must not announce that address anywhere.
  - **The address is in the title because the title replaces argv.** On Linux
    and macOS this is the process title proper: it overwrites the argv the
    kernel reports, which is what makes `pgrep silo` work and what takes the
    flags off the `ps` line, so the one detail worth seeing there had to move
    into the title. Several instances on one host stay distinguishable.
  - **On Windows it does not rename the process, and cannot.** An image name
    comes from the executable file; nothing a process does at runtime changes
    it. The assignment reaches `SetConsoleTitle` instead, which renames a
    foreground run's console and does nothing for a detached one — measured:
    a detached child is still `bun.exe` in Task Manager afterwards. Naming a
    process on Windows means shipping the compiled binary, whose image name is
    already `silo.exe`.
  - Cosmetic by design, so it never fails a start: the assignment is wrapped,
    and `silo status`/`silo stop` find a server through `silo.run.json` and a
    pid, never by name. Tests: `apps/server/test/runtime/process-title.test.ts`.

- **Collection editing now has the same management surface as entry editing
  (2026-08-21):** the schema editor uses the workspace top bar for cancel/save
  actions and, for an existing collection, shows a right-hand metadata rail
  with its scope, field and entry counts, and read-access mode. An editor that
  also holds the collection `delete` claim can delete it there through a
  typed-name confirmation; the confirmed action removes the schema and all
  of its entries, refreshes the sidebar, and navigates to the next collection.

- **silo runs as a service now: logs to a file, `--detach`, and one server per
  data directory (2026-08-21):** `silo serve` occupied the terminal it was
  started from and printed everything to it, so running silo meant `nohup`, a
  redirect, and no way to ask whether it was up. Four things changed
  (**D25**).
  - **Logging is configurable** — a `[log]` block (`level`, `file`, `format`,
    `requests`, `max_size_mb`, `max_files`), with `SILO_LOG_*` env vars and
    `--log-file` / `--log-level` flags on top. `Logger`
    (`apps/server/src/logging/logger.ts`) writes through `LogSink`s: `ConsoleSink` and a
    size-rotating `FileSink`. `text` is human-readable; `json` emits one object
    per line for a log shipper.
    - **Destination rule, stated once:** no `[log] file` → the console,
      always, so `silo serve > out.txt` keeps working. A `[log] file` → that
      file, *plus* the console only when stdout is a TTY. Someone watching a
      foreground server still sees it come up; a detached run has nobody
      watching, so the file is the only copy and there is no double write.
    - **`[log] file` has no default**, exactly like the fs media path: the
      console is right for a container, whose supervisor owns the stream, and a
      literal default here could not be told apart from a chosen path. Only
      `--detach` derives one, at `<data dir>/silo.log`.
    - Only `serve` logs. Every other subcommand keeps writing to stdout with
      `console.log`, because `silo keys list` emits *program output* — data a
      caller pipes somewhere — and routing that into a log file would take the
      answer away from whoever asked for it.
  - **`silo serve --detach` (`-d`)** spawns a detached child with its stdio
    redirected into the log file. The redirect is not how normal lines get
    there — `Logger` writes those itself — it is the net for everything that
    never reaches a logger: an uncaught stack, a Bun panic, a native crash.
    Losing those is how a background process becomes undebuggable.
  - **`silo stop`, `silo status`, `silo logs [-n N] [--follow]`.** `stop` sends
    SIGTERM and escalates to SIGKILL after `--timeout` (default 10s). `status`
    answers two separate questions — the OS says the process exists,
    `/api/health` says it is serving — because a wedged server is a different
    problem from a dead one. It exits non-zero when nothing is running, so a
    shell can branch on it.
  - **One server per data directory, enforced.** A running server records
    itself in `<data dir>/silo.run.json` (`RunFile`, `apps/server/src/runtime/`), and
    every `serve` — foreground or detached — refuses to start over a live one.
    This is not tidiness: two processes on one data dir silently corrupt it.
    The fs adapter holds `last_seq` in memory, so both hand out the same `seq`
    values (measured: two instances on one fs data dir produced `seq`
    2,2,3,3,4,4), and `seq` is the instance-global cursor a change feed will
    depend on. `Service`'s write mutex is process-local, so optimistic
    concurrency stops being sound too. No adapter can defend against this from
    where it sits, so the guard lives at the process boundary.
    - **Staleness is decided by asking the OS**, not by trusting the file:
      `kill(pid, 0)`. A server that was SIGKILLed or power-cut leaves its
      record behind, and that must never lock its own data directory out of
      use. The residual hazard is pid reuse, the same trade every pid-file
      daemon makes.
  - **The parent waits for the child's own run file, matched by pid** — never
    for `/api/health`. Probing health cannot tell "my child came up" from
    "something is on that port": a start that lost the port to another
    instance was reported as a success, with a pid that had already exited.
    Found while verifying the feature, fixed, and pinned by
    `apps/server/test/runtime/detached-serve.test.ts`, which starts two real
    servers on one port and asserts the second fails and says why.
  - **Multiple instances** work and always did — one `--data` and one
    `--listen` each. What was missing was the guard above and the management
    commands; sharing *one* data directory between processes remains
    unsupported. See the roadmap note below.
  - New: `apps/server/src/logging/` and `apps/server/src/runtime/`. `SiloServer`'s constructor
    now takes an options object (`SiloServerOptions`) rather than four
    positional arguments, two of them bare booleans. Tests:
    `apps/server/test/logging/logger.test.ts`, `apps/server/test/runtime/run-file.test.ts`,
    `apps/server/test/runtime/detached-serve.test.ts`, plus `[log]` layering in
    `apps/server/test/config/config-loader.test.ts`.

- **`silo init` scaffolds a config file (2026-08-21):** silo was configurable
  by TOML but shipped no TOML — you had to copy the sample out of the README
  and know which keys existed. `silo init` writes a `silo.toml` holding every
  setting at its default, each with a one-line comment and its alternatives
  beside it (`driver` sqlite|fs, the whole s3 block, `auth.disabled`,
  `allow_remote_refs`), so the file doubles as the reference.
  - **Rendered from `ConfigLoader.defaultConfig()`, not hand-written**
    (`InitCommand`, `apps/server/src/cli/commands/init-command.ts`). The scaffold
    therefore cannot drift from what silo does with no file present, and
    `apps/server/test/cli/init-command.test.ts` pins it by loading the written file
    back and comparing it to `defaultConfig()`.
  - **Settings with no default are written commented out.** The fs media path
    is the one that matters: unset means "follow the data dir", so a literal
    `path` here would look like a chosen value and silently stop `--data`
    relocating media — the exact bug the 2026-08-21 derived-default change
    fixed. The s3 credentials are commented for the same shape of reason plus
    one more: a config file is not a secret store, so the comment points at
    `SILO_BLOB_S3_*` instead. The README's sample block was carrying a literal
    `path = "./silo_data/media"` and now matches.
  - **Routed before the config is loaded and before storage is opened**
    (`cli.ts`), unlike every other subcommand: `--config` naming a file that
    does not exist yet is `init`'s normal case rather than `loadConfig`'s
    error, and writing a config must not create a data dir as a side effect.
  - Refuses to overwrite an existing file unless `--force`, creates a missing
    parent directory for `--config a/b/silo.toml`, and is the only subcommand
    that touches neither the data dir nor a running server.

- **Media gets a catalog, folders, search, and reference integrity
  (2026-08-21, D23/D24):** media stays instance-global — one library for the
  whole server, `media:*` still unscoped — but it now has a **record**, not
  just bytes. `listMedia` used to reconstruct metadata by string-splitting
  blob keys, so there was nowhere to put a folder, a tag or a reference, and
  no way to page or filter without stat-ing every blob.
  - **Catalog.** `_media` in `Scope.System`, one document per asset
    (`filename`, `folder`, `blob_key`, `size`, `content_type`, `hash`,
    `state`, `tags`), plus `_media_folders` for folders made before anything
    is filed into them. `BlobStorage` is untouched and stays byte-only at six
    methods. Both collections are **always** exported, never gated on
    `--with-keys` — bytes without their filenames restore a library with no
    organisation in it.
  - **Entries reference an asset by id**, `silo://media/<ulid>`
    (`MediaRef`, `@silo/shared/media-ref`), never by path. Renaming or moving
    a file is a catalog-field update that rewrites no entry and touches no
    blob. Blob keys stay flat (`<ulid><ext>`), so the archive's `media/`
    layout is unchanged and D23 needed **no `format_version` bump**.
  - **Usages are adapter-owned derived state, not a collection.**
    `Storage.put` now takes the entry's complete usage set and replaces it in
    the same operation; `delete`/`deleteProject`/`deleteEnvironment` drop
    matching usages; `listMediaUsages`/`countMediaUsages` answer the guard.
    SQLite writes `media_references` inside `put`'s existing seq transaction —
    an entry and its references land together or not at all. The fs adapter
    keeps **no index** and scans entry files, which writes nothing into the
    frozen layout and has no window where an rsync or `git checkout` under a
    running process makes the answer stale. Conformance pins
    delete-while-referenced on both.
  - **Why not a decorator.** A `Storage` wrapper can intercept
    `deleteProject`, but cannot be atomic with that method's bulk SQL delete,
    so entries would vanish while their usages survived and a file would stay
    blocked by referrers that no longer exist. The `usages` argument is
    **required**, not optional: an omitted set has no safe reading, so
    forgetting it is a type error at all four call sites (`Service`,
    `Importer`, `ScopeCopier`, test fixtures).
  - **Extraction is structural** (`MediaRefs.extract`), not schema-driven:
    §7.2 lets an archive carry content with no schema and import validation is
    off by default, so a schema-driven walk would find nothing in exactly the
    data nobody looked at. Over-capture blocks a delete (visible);
    under-capture orphans a live file (silent).
  - **Canonicalised on write** (`MediaRefs.canonicalize`). Reads resolve media
    fields into absolute URLs, so a client that fetches an entry, edits one
    field and PUTs it back returns `<base>/media/<id>` where
    `silo://media/<id>` went out — which would quietly turn a counted
    reference into an uncounted string. The write path rewrites it back before
    validating, so the schema judges exactly what gets stored. A
    `/media/<segment>` URL is disambiguated by shape: a catalog id is a bare
    ULID, while a blob key carries a dot (`<ulid><ext>`) or an underscore
    (pre-D23 `<sha256>_<name>`).
  - **Deletion is a saga** in `Service` under `writeMu`, because the catalog
    and a remote object store cannot share a transaction: refuse at non-zero
    usages, else commit `state: "deleting"`, delete the blob, delete the
    record. `ServeCommand` retries anything left staged at startup
    (`resumePendingMediaDeletions`), and `Service` refuses new references to a
    `deleting` asset. **No force-delete.**
  - **A failed blob delete explains itself.** `MediaDeleteStalledError` →
    `500 media_delete_stalled`, with `media_id`, `blob_key`, the underlying
    `reason`, and `remedy: "silo media reconcile"` in the body. Deliberately
    not a `409`: `media_in_use` is a refusal the caller fixes by editing
    entries, this is a storage failure they fix by fixing the blob store, and a
    client should tell them apart by code alone. The admin UI renders the
    explanation as a banner and badges the card `stuck deleting`, so the state
    is legible without reading server logs.
  - **The abort, automatic and reported.** A blob delete that fails
    permanently would strand an asset in `deleting` forever, so
    `silo media reconcile` **attempts** the delete and, when that throws,
    returns the asset to `active` (`aborted` in the result) and says so. It
    judges by the attempt, never by whether the blob is still there: a crash
    between the blob delete and the record delete leaves the bytes in place
    too, and that case must *complete*. Startup only ever retries — reversing
    a deletion is an operator decision — and counts failures rather than
    throwing, so a misconfigured blob store cannot stop the server booting
    over a deletion staged days ago (it prints a warning naming the fix). An
    aborted asset's bytes stay `claimed`, so it is not also reported as an
    orphan on the same pass. Verified live against a read-only blob directory:
    delete → `500` and `state: deleting`; restart → warning, server still
    boots; reconcile → returned to active; permissions restored → delete
    succeeds and both the catalog and the disk end up empty.
  - **The 409 is claim-aware.** `MediaInUseError` carries the *true* count;
    the route enumerates only referrers the key may read
    (`RouteAuth.canReadEntries`). Media is instance-global but referrers are
    scoped, so a project-confined key learns a file is in use without learning
    where — verified live: `usage_count: 1, visible_count: 0, referrers: []`.
  - **Search is the existing Query AST** over `_media` (`contains` on
    `filename`/`content_type`/`tags`, `eq` on `folder`) — **no new operator**,
    so §5.3's "every op is forever" cost is zero. Recursive folder filtering
    is done after the fact rather than adding a `prefix` op both adapters
    would carry forever.
  - **`silo media reconcile`** (`MediaCommand`, and `POST
    /api/media/reconcile`) backfills records for pre-D23 blobs, finishes
    staged deletions, prunes records whose bytes are gone, and *reports*
    orphans without deleting them. Pre-D23 entries holding `/media/<key>` are
    dual-read into a `blob:<key>` token and counted, so a partly backfilled
    instance still refuses to delete a referenced file.
  - **D24 closes D21's media deferral:** `/api/export` also needs
    `media:read`; `/api/import` and `/api/copy` also need `media:create`, plus
    `media:delete` in `replace` mode (which clears every blob first). The
    scoped copy (D22) touches no media and needs none.
  - **Cache header changed:** `/media/<id>` is no longer `immutable` — an id
    is stable while what it points at need not be — so it serves
    `max-age=3600` with an `ETag` of the content hash and honours
    `If-None-Match`.
  - Admin UI: the media library gains a folder rail, debounced server-side
    search, paging, rename/move, and a refusal dialog that lists the referrers
    it may show. `MediaWidget` writes `silo://media/<id>`, fetches the one
    asset it points at so a field shows a filename rather than an id, and
    searches the catalog server-side instead of filtering a local array.

- **`--data` now moves the media directory with it (2026-08-21):**
  `silo serve --data /tmp/foo` put SQLite at `/tmp/foo/silo.db` and uploads at
  `./silo_data/media` — one instance split across two locations, silent until
  somebody went looking for the files. `cli.ts` did guard the relocation on
  `!cfg.blob_storage.path`, but `ConfigLoader.defaultConfig()` filled that path
  in with `"./silo_data/media"`, so the guard could never fire.
  - **The default is now absent rather than literal.** `defaultConfig()` leaves
    the fs blob path unset, which is what tells "the user chose this" apart
    from "nobody said" — the distinction the old code needed and did not have.
    `ConfigLoader.resolveDerivedDefaults()` fills it in from `storage.path`
    **after** every layer of §10's flags > env > file hierarchy has been
    applied; a `[blob_storage] path`, `SILO_BLOB_PATH` or `--blob-path` is
    truthy by then and is left alone. Order matters, so the derivation is its
    own named step rather than a line inside `loadConfig` (which runs before
    flags) — anything applied after it can no longer tell derived from chosen.
  - **`--blob-path` is new**, so the flag layer can name the media directory
    the way the file and env layers already could.
  - Flag application moved out of `Cli.run` into `Cli.applyFlagOverrides`, a
    pure config→config step that `apps/server/test/config/config-loader.test.ts`
    can drive without booting a server; the tests pin the reported case and
    each explicit source that must survive it. Verified live: an upload to a
    server started with `--data <dir>` lands in `<dir>/media` and creates no
    `silo_data/` beside it, and `--blob-path` overrides both the env var and
    the file.

- **The first-boot root key gets a real banner (2026-08-20):**
  `BootstrapBanner` (`apps/server/src/cli/bootstrap-banner.ts`) replaces the `=`-rule
  block `ServeCommand` printed inline. It draws the admin UI's barrel mark
  beside a block `SILO` wordmark under a vertical indigo→lilac fade off
  `--accent`, then boxes the secret with a `ROOT API KEY` / `shown only once`
  header. The box is a selection guide as much as decoration — this is the one
  moment silo hands over a credential it can never show again (§8), and it
  lands mid-startup where it is easy to scroll past.
  - **Two renderings, chosen by whether anything is watching.** A TTY gets the
    coloured box; a pipe, a log file or a CI transcript gets the *original*
    flat ASCII, unchanged, so existing greps and captured logs keep working and
    no escape codes or box-drawing characters reach a dumb console. `NO_COLOR`
    (any non-empty value) wins over `FORCE_COLOR`.
  - Written with `process.stderr.write`, not `console.error`: Bun tints the
    latter red on a TTY, which would sit underneath the banner's own colours.
  - Box width is derived from the key length, and
    `apps/server/test/cli/bootstrap-banner.test.ts` pins that every box row renders
    the same visible width once escapes are stripped — the padding arithmetic
    counts characters the colour codes are not part of, which is the sort of
    thing that rots silently.
  - `silo keys create` still prints its plain one-liner; only the first-boot
    key is decorated.

- **The key creation page is rebuilt around projects and environments
  (2026-08-20):** `/servers/:sid/settings/keys/new` was written before D18–D20
  and had never caught up. It read its scope from `ScopeMemory` and showed it
  only as a `<code>` in the subtitle, with `SettingsView` substituting a
  hardcoded `{project: 'default', env: 'prod'}` when nothing resolved — a pair
  that need not exist on the instance. Minting a key for a scope you were not
  currently working in meant navigating elsewhere first to change what the page
  would silently inherit.
  - **The page is now label → reach → role**, with everything else behind one
    Advanced disclosure. The Standard/Custom segmented switch is gone: Custom
    started from an empty claim set, so "read and write, plus media upload"
    meant rebuilding an eight-column matrix by hand.
  - **Reach is an explicit control** (`NewKeyReach`, `KeyReach`) naming the
    project and env segments separately, so all four shapes the claim grammar
    allows are reachable — including `*`/`prod`/`*`, every project's `prod`,
    which the old three-option "Environment / Project / All Projects" could not
    express. The env is a picker when the project is concrete and free text
    when it is not, because that reach names an environment *id* that may exist
    in projects the current key cannot list.
  - **`manage` is a real preset in `@silo/shared`** (`ClaimPreset`,
    `Claims.presetPermissions`), not a UI-only bundle, so
    `silo keys create --preset manage` means the same thing. It is `write` plus
    `create`, `schema:update`, `access:update` and `delete` — collection
    lifecycle, previously reachable only one collection at a time through the
    matrix. `fromPreset` now derives from two `Record<Exclude<ClaimPreset,
    "root">, …>` tables, so a future preset that forgets to say what it grants
    is a compile error rather than a preset that silently grants nothing.
  - **A `transfer:*` toggle now carries D21's prerequisites with it.**
    `NewKeyPlan.transferRequirements` composes `Claims.TransferRead`/`Write`/
    `ReplacePermissions` at `*`/`*`/`*` into the requested set, shows them
    inline, and blocks the toggle when the minting key cannot delegate them.
    The old page named the requirement in a sentence of help text and did
    nothing about it, so it would happily mint a `transfer:import` key that
    403s on every import. Replace authority is a separate nested opt-in rather
    than riding along with Import.
  - **Delegation shapes the controls, not just the final banner:** reaches and
    roles the current key cannot grant are disabled with the reason, computed
    from the collection half of the plan only, so an undelegatable instance
    capability greys out its own toggle instead of every reach at once.
  - **Advanced holds a raw claim editor** seeded from whatever the controls
    produced, validated live through `Claims.normalize`/`canDelegate`. While it
    is open the guided controls are disabled behind a visible "Return to guided
    controls" — no attempt at bidirectional sync, which is what lets the guided
    layer stay small without trapping anyone.
  - **The review reads as grouped sentences** (`ClaimGroups`) with a live
    access-level pill in the top bar's vocabulary, and the raw list one
    disclosure away. The success screen shows the same grouping.
  - New files under `apps/admin/src/views/keys/`: `key-reach.ts`, `new-key-plan.ts`,
    `claim-groups.ts`, `NewKeyReach.tsx`, `NewKeyCapabilities.tsx`,
    `NewKeyReview.tsx`, `NewKeySecret.tsx`. `NewKeyView` no longer takes a
    `collections` prop — it lists its own, for the scope it is actually
    targeting — and takes `scope: ScopeRef | null` plus `projects`.
  - The settings scope now seeds the reach through an effect rather than
    `useState`'s initial value: it resolves over two round trips and is still
    `null` on first paint, so reading it once produced empty segments and a
    `collections://*:schema:read` that `Claims.normalize` threw on. Composition
    yields no collection claims until the reach is answerable.

- **Transfer write claims now cover the schema writes an import performs
  (2026-08-20, D21):** `Claims.TransferWritePermissions` listed only
  `entries:create`/`:update`/`:delete`, but `Importer.executeScopedImport` calls
  `putSchema` for every collection an archive carries — in *both* modes — and
  `deleteSchema` in `replace`, besides creating the projects, envs and
  collections the archive names. A key holding `transfer:import` plus those
  three entry permissions at `*/*/*` could therefore overwrite or delete every
  collection schema in the instance while holding `schema:update`, `create` and
  `delete` at no scope at all — the grant of unheld authority D21 exists to
  deny.
  - **The write list is now `create` + `schema:update` + `entries:create` +
    `entries:update`, and deletion moved to a new
    `Claims.TransferReplacePermissions` (`delete` + `entries:delete`) checked
    only when `mode=replace`** — by `POST /api/import` and `POST /api/copy`
    alike. This mirrors D22's existing `ScopeCopyWritePermissions` /
    `ScopeCopyReplacePermissions` split, and is what the apply stage actually
    exercises: `merge` deletes nothing, so requiring delete authority for it was
    the mirror-image error. An unrecognised `mode` is not `replace`, so it
    clears the write guard and is then rejected as a `400` by
    `Importer.executeImport` rather than being treated as one.
  - **The UI gates on the same two constants.** `ExportImport.tsx` adds
    `canReplaceAll` beside `canWriteAll`; a merge-capable key keeps the Export,
    Import and Copy panels and only loses the **Replace** option in both mode
    selects (disabled, labelled *needs instance-wide delete*), rather than
    losing the whole panel or being offered a button that 403s.
    `CopyServerPanel` takes it as a `canReplace` prop.
  - Media is still the outstanding half of D21's deferral: the import path
    writes blobs, and clears them in `replace`, without requiring
    `media:create`/`media:delete`. `media:*` is instance-global and unscoped, so
    closing it is a separate change and is now called out in D21 rather than
    implied.

- **Top bar session pill now states scope access, not the key's name
  (2026-08-20):** the pill read `key label · server name`
  (`${sessionInfo?.label || Claims.label(claims)} · ${server.name}`), and both
  halves were already on screen — the server name is the sidebar's scope
  switcher heading, and a key's label is chosen by whoever minted it, so it
  tends to echo the server it was made for (`read · silo-read`). Neither half
  changed as the user moved around, so the pill cost topbar width to repeat the
  sidebar.

  It now shows what the current key can actually do **in the scope on screen**:
  *Full access* / *Read & write* / *Read-only* / *No access*.

  - **Why this and not the label.** The level is *derived*, so unlike a label it
    changes with the route: one key scoped to `default/prod` reads `Read-only`
    there and `No access` in `default/dev`. It is also the only chrome that
    answers "why is there no New entry button here?" — the claims that hide an
    action and the pill now come from the same place.
  - `Claims.accessLevel(claims, project?, env?)`
    (`packages/shared/src/claims/claims.ts`) returns the `AccessLevel` band
    (`packages/shared/src/claims/access-level.ts`). Bands are widest-first: **any** write
    permission anywhere in the scope — entries, collection create/delete, schema
    or access update — makes it `write`, because a pill claiming read-only
    beside a live create button is the more misleading of the two errors.
    Omitting the scope asks the same question instance-wide, which is what
    settings needs when no scope has resolved. `shared/test/claims.test.ts`
    pins the bands, including that non-collection claims (`media:*`, `keys:*`,
    `transfer:*`) grant no scope access on their own.
  - **The key's identity moved to the tooltip** — `buildSessionBadge`
    (`apps/admin/src/views/shell/build-session-badge.ts`) puts label, prefix and scope
    in `SessionBadge.detail`, with the full record still at Settings →
    Connection. `TopBar`'s `session` prop is a `SessionBadge`
    (`apps/admin/src/views/shell/session-badge.ts`) rather than a string, so the 14
    views that forward it are typed rather than formatting their own.
  - Only the dot is tinted (`--session-tone`): accent for root, `--ok` for
    write, `--text-3` for read-only, `--bad` for none. This is a standing fact
    about the session, not an alert, so the label stays `--text-2`.
  - Fixed alongside: the stored key prefix already ends in an ellipsis
    (`KeyFormat.displayPrefix`), so the Connection page's `${keyPrefix}…`
    rendered `silo_uTNaCEf……`.

- **Consolidated server/scope switcher & modal Server Browser (2026-08-20):**
  - Removed redundant ways to navigate back to the servers view (topbar Globe "Servers" button, topbar Lock icon button, and settings nav Globe icon).
  - The left sidebar below the Silo logo/version is now the single scope switcher (`silo-server-name \n project · env`), displaying up/down chevrons (`ChevronsUpDown`).
  - Clicking this switcher opens the 3-column `ServerManager` component in a modal dialog on the same page with the active server, project, and environment pre-selected and highlighted, making switching fast and seamless without leaving the workspace.
  - The Silo brand logo in the sidebar links directly to the current workspace collections view (`Routes.collections(serverId, scope.project, scope.env)`).
  - `ServerManager` supports modal mode when `onClose` is provided, with a backdrop overlay, header close button ('×'), click-outside dismissal, and Escape-key listener.

- **Settings split by scope, and env→env data transfer (2026-08-20):** settings
  was one flat, unscoped list (`/servers/:id/settings/:section`) covering
  General, Projects, Environments, API Keys, Data Transfer and Connection &
  Status. That predated D18–D20: a collection is identified by
  `(project, env, collection)`, so most of what settings configures belongs to a
  particular project or environment, not to the server. It is now three nav
  groups with scope nested inside them, and every page lives at a URL that says
  which scope it configures.

  ```
  SERVER
    API Keys                                       /servers/:sid/settings/keys  (+ /keys/new)
    Data Transfer                                  /servers/:sid/settings/transfer
    Connection                                     /servers/:sid/settings/connection
  PROJECTS
    Projects                                       /servers/:sid/settings/projects
      [ project switcher ▾ · New project ]
      General                                      /servers/:sid/projects/:p/settings/general
      Environments                                 /servers/:sid/projects/:p/settings/environments
        [ environment switcher ▾ · New environment ]
        General                                    /servers/:sid/projects/:p/environments/:e/settings/general
        Data Transfer                              /servers/:sid/projects/:p/environments/:e/settings/transfer
  APPLICATION
    Appearance                                     /servers/:sid/settings/appearance
  ```

  - **Ordered outside-in, and nested the way the data is.** The server hosts
    everything, so it comes first; then the projects it holds; then this
    browser. One project's pages hang off the project index and one
    environment's off that project's environment list — neither is a peer of
    the list it belongs to, because neither exists outside it.
  - **Both nested blocks start collapsed** and open when the route enters them,
    so the nav reads as seven rows until you are actually working inside a
    scope. A parent row's disclosure control is a **sibling** of its link, not a
    child: nesting a button inside an anchor is invalid, and expanding a parent
    must not navigate to it. Navigating out leaves a block as the user left it —
    collapsing under the cursor would be its own surprise.
  - **The way out of settings returns to the scope you were in.** The nav header
    is a back control to that scope's workspace
    (`Routes.collections(serverId, project, env)`), with the gate demoted to a
    small icon button beside it. Before, the only exit was the gate, so leaving
    settings meant re-picking the project and environment you were already
    working in. `Workspace` redirects a bare collections URL to the scope's
    first collection, so the button lands on real content rather than an index.
    With no scope resolved — a server holding no project — the control falls
    back to the gate and says so. Ancestor breadcrumbs are links too, so a page
    two levels deep has a one-click way up as well as out.
  - **An index row is the link to that item's own page.** Projects and
    Environments are indexes, not control panels: a row opens that project's or
    environment's settings, and **delete lives only on the single-item page**,
    where the danger zone can say what is about to be lost and gate it on typing
    the id. A delete button in a list is one stray click from taking a whole
    project's environments with it.

  - **The scope prefix is the workspace routes' prefix, with `settings` as the
    tail** — identical to the HTTP API's
    `/api/projects/{project}/environments/{env}/…` — so a workspace URL becomes
    its settings URL by swapping that tail, and switching context swaps one path
    segment. Server-level pages deliberately take **no** scope prefix: a key or
    a connection belongs to the instance, and prefixing them would let one page
    be bookmarked at as many URLs as there are scopes.
  - **The nested rows still need a scope to point at** while an unscoped page is
    open, so the nav's shape does not change under the cursor as you move
    between scoped and unscoped pages.
    `useSettingsScope` (`apps/admin/src/views/settings/use-settings-scope.ts`) resolves
    one from the route, else the remembered scope, else the server's first
    project and env. `ScopeMemory` (`apps/admin/src/utils/scope-memory.ts`) persists it
    per server in `localStorage` (`silo_active_scope`); `Workspace` writes it,
    since that is where a scope is known for certain.
    - `ScopeMemory.pick` checks the remembered id against what the server still
      lists, deferring while the list loads. Without that, deleting the
      environment you were last in left the switcher displaying it and linking
      to pages that 404 — which is exactly what happened before the check went
      in. `apps/admin/src/utils/scope-memory.test.ts` pins it.
  - **Scope-bound pages are keyed on their scope** in `SettingsView`. Without
    the key, switching environment on the Data Transfer page kept the previous
    environment's copy result on screen and re-labelled it with the new
    environment's name — reporting a copy that never happened.
  - **`Routes.parse` grew three settings views** (`server-settings`,
    `project-settings`, `env-settings`) and `Routes.legacy` rewrites the old
    URLs (`settings/general` → `settings/appearance`; `settings/environments`
    and `settings/envs` → the project-scoped environment list; a bare
    `settings` → the project index; `/status` → `settings/connection`), running
    in `App` before `parse`, which knows nothing about the aliases. `apps/admin/src/router/routes.test.ts` pins the grammar,
    round-trips every builder, and asserts no alias target is itself an alias —
    the loop that would otherwise be a redirect cycle.
    - `ServerRoute` had to stop being `Extract<Route, {project, env}>`:
      `env-settings` has both fields and would have been silently pulled into
      the union `Workspace` consumes. It lists its five views explicitly now.
  - **Deleting a project or an environment is gated on typing the id back**
    (`apps/admin/src/components/DangerConfirm.tsx`, built on the existing `Modal`
    primitives). Forgetting a saved *server* is not — it destroys nothing on the
    instance — and keeps a plain confirmation.
  - **Project deletion moved into Project → General**, and the project index
    stayed a real page at `/servers/:sid/settings/projects` — it is what the
    project block nests under. Server → General is gone, though:
    it held the appearance settings, which are `localStorage` and browser-wide,
    so they became their own APPLICATION group, and Connection already reports
    the version, key and claims a server-info page would have.
  - **Two long-standing scope bugs fell out of having a scope in the route.**
    `NewKeyView` was mounted with `scope={{project: 'default', env: 'prod'}}`
    hardcoded and `collections={[]}`, so its collection chooser was always empty
    and its claims always named the wrong scope; `ExportImportView` got
    `collectionCount={0}` and a no-op `onImported`. Both now receive the
    resolved scope and its real collection list.
  - **`StatTile`/`StatRow` (`apps/admin/src/components/`) replace three identical local
    copies** of the same result-count tile — `ExportImport`'s `StatTile`,
    `CopyServer`'s `CopyStat`, and the one the new transfer page needed. Their
    CSS moved out of `Transfer.module.css` with them. The nav CSS moved from
    `SettingsView.module.css` to `SettingsNav.module.css`, and that file's
    hand-rolled modal and project-tab rules are deleted, since the pages use the
    shared `Modal` primitives now.
  - `apps/admin/src/**/*.test.ts` are their own TypeScript project
    (`ui/tsconfig.test.json`), because they need both DOM and Bun types: the app
    project must not see Bun globals and the repo-root project must not see DOM
    globals. They run under the same root `bun test` as the server suites.

- **Environment-to-environment copy, no archive (2026-08-20, D22):** promoting
  `dev` to `staging` needed a whole-instance archive round trip, and — because
  D21 requires instance-wide authority for `transfer:*` — a key with rights over
  every other tenant to do it. `POST /api/projects/{project}/environments/{env}/copy`
  copies one scope of an instance onto another, destination-driven like
  `/api/copy`: the route names the destination, the body names the source
  (`{from: {project, env}}`) with the same `mode`/`prefer`/`validate`/`dry_run`
  options an import takes. Both `/environments` and `/envs` are registered from
  one handler.
  - **It owns no merge logic.** `Importer.executeImport` already accepted
    `{manifest, scopes}` in memory rather than a directory, so `ScopeCopier`
    (`apps/server/src/core/transfer/scope-copier.ts`) only reads the source scope out of
    `Storage` into the same `ScopedImport` shape `ImportWalker` builds from an
    archive, re-enveloping each entry onto the destination — the same rule D18
    gives an archive, where the address is authoritative and the entry's own
    `project`/`env` are overwritten. Merge/replace/prefer/dry-run therefore have
    one implementation and copy cannot drift from import. `ParsedImport` is
    exported for it; `Service.copyScope` wraps it in the write mutex like
    `importDir`.
  - **No `transfer:*` claim is required, and that is the point.** A scoped copy
    reaches nothing the caller could not already reach by listing the source
    through the entry API and writing the destination through it, so the guard
    asks for exactly the permissions that loop would need:
    `Claims.ScopeCopyReadPermissions` at the source,
    `ScopeCopyWritePermissions` at the destination, and
    `ScopeCopyReplacePermissions` there in `replace` mode — all via the new
    `Claims.hasScopeWide` / `RouteAuth.requireScopeWide`, the scoped
    counterparts of `hasInstanceWide` / `requireInstanceWide`. A key confined to
    one project can move data between that project's environments and no others.
    Requiring a fixed claim on top would reintroduce the coupling D21 exists to
    prevent.
  - Copying a scope onto itself, or naming `Scope.System` on either side, is a
    `400`. `_`-prefixed collections (`_keys`) are never carried. Media is
    instance-global and unscoped, so a scope copy moves none — the UI says so.
  - Because both sides share an `instance_id`, the importer's last-resort
    tiebreak (`manifest.instance_id > local`) is false, so an entry identical in
    `updated_at` and `rev` is `skipped`. That is the right answer: nothing
    distinguishes the two copies.
  - `apps/server/test/http/scope-copy.test.ts` covers merge/replace/prefer, dry-run
    writing nothing, the self-copy and malformed-source `400`s, a
    project-scoped key succeeding within its project and 403-ing outside it,
    replace without delete authority, `_keys` never travelling, and the `/envs`
    spelling authorizing identically.

- **Expandable sidebar and in-memory collections search (2026-08-20):** the
  sidebar in the connected workspace shell (`apps/admin/src/views/shell/Sidebar.tsx`) is
  now user-resizable and provides in-memory search filtering for collections.
  - **Expandable / Resizable Sidebar:** A drag handle along the right edge of
    the sidebar allows smooth click-and-drag horizontal resizing between 190px
    and 500px (default 248px), preventing text selection and displaying a resize
    cursor while dragging. The chosen width is persisted to `localStorage`
    (`silo_sidebar_width`). Double-clicking the resizer handle resets the width
    to the 248px default. Long collection names use ellipsis truncation with
    tooltips.
  - **In-Memory Collections Search:** A search input field under the Collections
    group header allows filtering collection names in real-time. Features
    an instant clear button, Escape-key clearing, and a dedicated empty state
    when no collections match the query.

- **Entries could only be saved once — `rev` is now in the API response
  (2026-08-20):** `PUT`/`DELETE` on an entry require the expected revision as
  `If-Match`/`?rev=` (§8), but `EntryUtils.toApiResponse` returned only
  `id`, the user fields, and the timestamps — no client could ever learn a
  revision. `EntryMapper` filled the gap with `rev ?? 1`, which is right
  exactly once: the first edit of an entry succeeded, bumped the stored rev to
  2, and every later save 409'd with `rev mismatch: expected 1, current is 2`.
  The admin UI could not update the same entry twice.
  - `toApiResponse` now emits `rev` beside `id`, and deletes a user field of
    that name from the data first, so the envelope value can't be shadowed —
    the same treatment `id` already had. `collection`, `seq`, and the scope
    stay hidden; those are internal and no client is asked for them back.
  - Re-fetching the entry before each save was the alternative and is worse:
    blindly adopting the current revision is precisely the lost-update the
    `If-Match` rule exists to prevent.
  - `apps/server/test/http/entries-api.test.ts` pins the new shape: a list item
    carries `rev` (and still no `seq`/`project`/`env`), two consecutive
    updates using each returned rev both succeed while a stale rev still
    `409`s, and a collection with a user field named `rev` reports the
    envelope revision. 159 tests pass across 17 files.
  - IMPLEMENTATION.md §5.1 said the response hides `rev` "exactly like
    `collection`/`seq`" and README documented `If-Match` without saying where
    a revision comes from; both now describe the response as it behaves.

- **Expand/collapse all on an array field (2026-08-20):** the array header
  carries a toggle whenever it holds more than one collapsible item. Items
  report their open state up through `ArrayItemsContext` and the header names
  the action that would actually change something ("Expand all" unless every
  item is already open) rather than guessing from its own last click. The
  instruction travels back down the same context as `{open, nonce}`; the nonce
  is what makes a second "Collapse all" reach an item the user reopened in
  between. A nested array only ever answers its own toggle, since each
  `ArrayFieldTemplate` provides the context its own items read.

- **Reference-list items are collapsible (2026-08-20):** an array of `$ref`
  items rendered every item's fields inline, so a five-question FAQ list was
  five stacked forms, each headed by RJSF's `faqs-1`/`faqs-2` — a label that
  repeats the array's name and a position and says nothing about the item.
  Array items whose schema is composite (an object, or an unresolved-ref
  marker) now render as a collapsed card: a header row with a disclosure
  chevron, the position as mono metadata, the item's own title, and the
  move/copy/remove actions, with the fields in a collapsible body. Scalar
  items (media arrays, enums) keep the flat row layout — there is nothing to
  summarize. UI-only: no schema, API, or server change.
  - **The title is the item's first filled field.** `ValueTitle`
    (`apps/admin/src/utils/value-title.ts`) walks the value's fields in render
    order — `ui:order`, else `x-silo-ui.order`, else the schema's property
    order, falling back to the value's own keys when the schema declares none
    (an unresolved-ref marker carries no `properties`) — and takes the first
    non-blank scalar, truncated at 90 characters. Nested objects and arrays
    are skipped rather than stringified into the header. It lives under
    `utils/` rather than `forms/` because the entries table needs the same
    rule (below), and that table is not a form.
  - **RJSF hands item data to the item's `SchemaField`, never to
    `ArrayFieldItemTemplate`**, which is exactly where the header needs it, so
    `ArrayFieldTemplate` publishes the live array through `ArrayItemsContext`
    and each item reads its own slice by `index`. The title tracks typing in
    the first field rather than only the loaded value.
  - **An item with no title opens; a titled one starts collapsed.** Nothing to
    show in the header means the user still has to fill it in — a just-added
    item — and RJSF exposes no "this item was added just now" signal, so the
    same answer is derived from the data.
  - **The duplicate label is suppressed at its source.**
    `ArrayItemHeaderContext` carries the id of the field an item header already
    names; `ObjectFieldTemplate` (object items) and `JsonField` (raw-JSON
    items, which render their own label row rather than going through
    `FieldTemplate`) skip their label when it matches. Objects nested deeper
    inside the item still get their group label.
  - **Errors inside a collapsed item surface on its header.** The body is
    hidden with the `hidden` attribute rather than unmounted, so the error is
    still in the DOM and
    `.item:not(.open):has(:global(.field-error))` lights a marker in the
    header. `.body[hidden]` needs an explicit `display: none`, because the
    module's own `display: flex` otherwise beats the UA's `[hidden]` rule.
  - `ArrayFieldTemplate`'s `<fieldset>` gained `min-inline-size: 0`: a
    fieldset's UA `min-content` floor plus a one-line header title meant the
    array refused to narrow below its widest untruncated title and pushed the
    form into horizontal overflow on a narrow viewport.
  - `ObjectFieldTemplate` detected the root object with `props.idSchema?.$id`,
    a v5 prop name that is always `undefined` under RJSF v6 — so the root was
    rendering the group label the check exists to suppress. It reads
    `fieldPathId.$id` now.
  - **The entries table showed `[object Object]`.** `CellValue` rendered array
    elements with `String(v)`, so a reference-list column was a row of
    `[object Object]` chips. Chips (and a plain object cell, which showed a
    bare `{…}`) are now labelled with the same `ValueTitle` rule the form
    headers use, capped at `24ch` with the full text on `title`; a value with
    no scalar to show still falls back to `{…}`.
  157 tests still pass (no server surface changed).

- **Array of reference types in schema (2026-08-19):** a schema property can
  now be `type: array, items: { $ref: "silo://collections/<name>" }` end to
  end, not just a single-item `$ref`. Server-side this already worked — AJV
  follows `$ref` inside `items`, `SchemaBundler.collectRefs` walks `items`,
  and `Service.findSchemaReferrers` already matched array-items refs for the
  delete-conflict check — so no server domain/service/bundler change was
  needed. Three UI gaps were fixed:
  - **Visual schema editor:** a new `ref-array` field kind ("Reference list"
    in the Type dropdown) emits `type: array, items: { $ref }`, round-trips
    through `propToField`/`fieldToProp`, and reuses `RefTarget` (with an
    `isArray` flag so the hint reads "Each array item must match the
    collection's schema"). `SchemaEditor.tsx` is the only place the kind
    list lives.
  - **Entry form rendering:** `buildUiSchema` mis-routed arrays whose
    `items` is a `$ref` into the tags widget (the condition `!p.items?.type`
    matched `{ $ref }`), so the entry form showed a chip input instead of
    nested object fields. Arrays with `items.$ref` (or an
    `x-silo-unresolved-ref` marker on `items`) now fall through to RJSF's
    stock `ArrayField`, which renders each item through the referenced
    collection's schema after `SiloRefs.resolveForForm` has rewritten
    `items.$ref` to an internal `#/$defs/...` pointer. The resolved-item
    branch recurses into the target so widget selection applies inside
    referenced collections too; the marker branch routes each item to the
    raw-JSON fallback field. The tags branch gained a `!p.items?.$ref`
    guard so a `{ $ref }` items never silently matches it.
  - **Field constraint hint:** `FieldTemplate.constraintHint` now reports
    `array<reference>` when `items` carries a `$ref` or the unresolved-ref
    marker, instead of the bare `array` it produced before.
  - **Array templates:** the slate RJSF theme now supplies array-specific
    templates (`ArrayFieldTemplate`, `ArrayFieldItemTemplate`,
    `ArrayFieldItemButtonsTemplate`, `ArrayFieldTitleTemplate`,
    `ArrayFieldDescriptionTemplate`) and a slate `ButtonTemplates` set
    (`AddButton`, `MoveUpButton`, `MoveDownButton`, `CopyButton`,
    `RemoveButton`) built from the shared `Button` component and Lucide
    icons. Previously, reference-list arrays fell back to RJSF's default
    Bootstrap templates, so the add button and item toolboxes rendered with
    `btn btn-info`, `glyphicon`, and `col-xs-*` classes that do not exist in
    the Slate CSS, breaking the form visually. Each array item is now a
    card with the object fields on the left and move/copy/remove actions
    on the right; the add action is a full-width dashed button. These
    templates live under `apps/admin/src/forms/templates/` and are wired into the
    theme in `apps/admin/src/forms/theme.ts`.
  Tests: `apps/server/test/core/schema-refs.test.ts` gained three cases pinning
  array-of-refs validation, bundling (items `$ref` preserved + `$defs`
  populated), and the delete-conflict check. 157 tests pass across 17 files.

- **READMEs rewritten (2026-08-18):** `README.md` restructured along
  conventional open-source lines (why, quick start, concepts, configuration,
  CLI, HTTP API, auth/claims, portability, deployment, development, roadmap,
  contributing) and `ui/README.md` replaced (it was still the stock Vite
  template). Documentation only, no behavior change. Writing them against the
  code surfaced four drifted claims in the old README, now corrected: entry
  list responses are `{"data": ...}`, not `{"items": ...}` (collections,
  projects and envs *do* return `items`); key creation lives at
  `/servers/:serverId/settings/keys/new`, not `/s/:serverId/keys/new`; the
  "HTTP API stays flat, every request runs against a default scope" paragraph
  predated D19/D20; and `default_project`/`default_env`, `SILO_DEFAULT_*`,
  `serve --project/--env`, the `X-Api-Key` header, and the media endpoints were
  undocumented. Two facts are documented as they behave rather than as
  IMPLEMENTATION.md describes them: the admin UI is served from `./ui/dist`
  relative to the process working directory (no `go:embed` equivalent, so a
  compiled binary is not self-contained — no longer true as of the release
  work at the top of this file, where the binary gained the UI), and
  `EntryUtils.toApiResponse` omits
  `rev`, so the `If-Match`/`?rev=` requirement on entry `PUT`/`DELETE` is
  documented without claiming the API hands clients a revision to send.
  (That second one was a bug, not a documentation nuance — fixed 2026-08-20
  below, and the README now says the response carries `rev`.)
  Neither README links CONTEXT.md or IMPLEMENTATION.md any more: they are
  working docs for contributors, not part of the public front door, so the
  conventions and format-stability points the README needed are now stated
  inline. The roadmap section names MCP support, third-party storage/blob
  adapters against a published conformance suite, and richer backup options
  (scheduled and incremental exports, retention, remote targets), with the
  older designed-for work (sync, tombstones, key expiry, relations, search)
  kept as one closing line.
  The pitch was then reframed (2026-08-18, same day): the README used to lead
  with portability, which is a *consequence*, not the reason to pick silo. The
  opening and the "Why silo" section now lead with four pillars, simple,
  lightweight, standard, and customizable, each stated concretely (one process
  and no user accounts; six runtime deps and no sidecar services; JSON Schema,
  JSON, REST, ULID, RFC3339, tar, S3, TOML; ports plus per-key claims plus
  `x-silo-*` keywords plus a replaceable admin client), with portability
  presented as what those four add up to. The one-line pitch is "A small,
  standards-based headless CMS. Define collections in JSON Schema, get an admin
  UI with generated forms and a REST API, and swap out any part of it."
  `package.json`'s `description` and the CLI usage banner still carry the older
  "minimal portable headless CMS" framing and were left alone.

- **Project/env review fixes (2026-08-18):** review of the project/env work
  found the two adapters had drifted apart on the new port surface, and that
  scoping had opened holes the flat namespace never had. All fixed in this
  change set.
  - **A scope exists when it was created explicitly *or* still holds content**
    — both halves, both adapters, now stated on the `Storage` port and pinned
    by conformance. SQLite already answered this from its `projects`/
    `environments` rows; the fs adapter had only directories, which are
    ambiguous (nothing prunes the tree when a scope's last schema and entry
    go), so it answered "content only". Two bugs fell out of that single
    divergence, and neither was reachable by the test suite because the only
    coverage for the six new port methods lived in `projects-api.test.ts`,
    which runs on SQLite alone:
    - **Empty projects and envs were dropped from every fs export.**
      `Exporter` enumerates `listScopes()`; fs reported nothing for a
      registered-but-empty scope, so `silo export` on the fs driver silently
      lost it. The existing round-trip guard passed only because it ran on
      SQLite.
    - **Ghost projects on fs.** Deleting the last schema/entry of a scope that
      was never created explicitly left it listed by `listProjects()` and
      `listEnvironments()` forever, where SQLite dropped it.
    `FsStore` now writes a `.silo-project`/`.silo-env` marker on create — the
    directory equivalent of the row — and derives all three listings from
    "marker or content". The six methods are covered in
    `storage-conformance.ts`, so both drivers are held to one answer.
  - **`initDefaults` validates its ids** (`--project`/`--env`,
    `default_project`/`default_env`, `SILO_DEFAULT_*`). Unvalidated, a typo
    such as `SILO_DEFAULT_ENV=PROD` created a project that `GET /api/projects`
    listed, no scoped route could address (`Scope.of` rejects it at the
    boundary), and `deleteProject` refused to delete for the same reason —
    unreachable and unremovable. `serve` now fails at startup instead.
  - **`force` guards collections, not just entries.** `deleteProject`/
    `deleteEnvironment` counted rows only, so an un-forced delete destroyed
    every schema in a scope and reported `204` — the normal state of a project
    right after it is modelled. `deleteProject` also now inspects every env
    before erasing any of them, so a conflict in a later env can't leave
    earlier ones already emptied.
  - **Project enumeration is claim-scoped.** `GET /api/projects` treated any
    *fixed* claim as instance-wide visibility, so a key holding only
    `media:read` could list every tenant's project name. Visibility now comes
    from collection claims alone, matching what the env listing already did.
  - **`transfer:*` no longer escapes a key's scope (D21).** An archive spans
    every project and env, so `transfer:export` alone let a project-scoped key
    read every other project (and `transfer:import` overwrite them). Export
    now also requires `collections:*/*/*` `schema:read` + `entries:read`;
    import and copy require `collections:*/*/*` `create`/`schema:update`/
    `entries:create`/`entries:update`, plus `delete`/`entries:delete` in
    `replace` mode (the write list first shipped as the three `entries:*`
    permissions alone, which missed the schema writes the apply stage
    performs — corrected in the entry at the top of this file). Media stays
    instance-global and unscoped — a known deferral, now called out as one
    rather than implied.
  - **Anonymous project/env discovery is cached.** It has to know which scopes
    expose a public collection, which means reading every schema in the
    instance — an unauthenticated request walking every project × env × schema
    on every call. `Service.publicScopes()` derives it once and drops it
    alongside the compiled-validator cache.
  - **`ProjectRegistry` deleted.** D20's dedicated tables superseded D19's
    `_projects` collection; nothing had written it since, and the docs
    described it as live in four places while contradicting themselves in a
    fifth.
  - `Scope.validateProject`/`validateEnv` replace `Scope.of(project, "prod")`
    as the project-only validator, and the `/environments` + `/envs` route
    pair is registered from one handler so authorization can't drift between
    the two spellings.
  - 153 tests pass across 17 files.

- **General Settings Tab & Theme Customization (2026-08-18):**
  Added a **General** tab to the Settings view for personalized typography and accent color theming.
  - **Google Fonts Support:** Users can pick from curated Google Fonts (Hanken Grotesk, Inter, Outfit, Plus Jakarta Sans, Poppins, DM Sans, Space Grotesk, Montserrat, Playfair Display, JetBrains Mono, Syne, etc.) or type any Google Font name to dynamically inject and apply `--font-ui`.
  - **Accent Color Customizer:** Preset color swatches (Indigo, Violet, Sky, Cyan, Emerald, Teal, Amber, Coral, Rose, Magenta, Sunset, Lime) plus native color picker and HEX input updating `--accent`, `--accent-soft`, and `--accent-ink`.
  - **Persistence & ThemeManager:** `ThemeManager` (`apps/admin/src/utils/theme-manager.ts`) persists user preferences in `localStorage` (`silo_appearance_settings`) and initializes them on app bootstrap (`apps/admin/src/main.tsx`) with zero flash of unstyled content.
  - **Live Previews & Reset:** Real-time preview card for typography and UI elements, along with a "Reset to Defaults" action.

- **Decoupled Projects & Environments Architecture (2026-08-18):**
  Decoupled `Scope` into individual `Project` and `Environment` entities (D20 in IMPLEMENTATION.md).
  - **SQL Tables:** Dedicated `projects` (`id, created_at, updated_at`) and `environments` (`project, id, created_at, updated_at, PRIMARY KEY (project, id)`) tables.
  - **Server Defaults:** Defaults to `project: default, env: prod` on startup via `Service.initDefaults(...)`. Configurable via `--project` and `--env` CLI flags, TOML configuration, and environment variables `SILO_DEFAULT_PROJECT` and `SILO_DEFAULT_ENV`.
  - **Individual Storage & REST APIs:**
    - `createProject(project)`, `listProjects()`, `deleteProject(project, force)`
    - `createEnvironment(project, env)`, `listEnvironments(project)`, `deleteEnvironment(project, env, force)`
    - Endpoints: `GET /api/projects`, `POST /api/projects`, `DELETE /api/projects/:project`, `GET /api/projects/:project/environments`, `POST /api/projects/:project/environments`, `DELETE /api/projects/:project/environments/:env`.
  - **Key Scoping:** Keys can be scoped to an entire project (`project/*/*`), a specific environment (`project/env/*`), or specific collections.
  - **Multi-Pane UI:** The `/servers` UI has been expanded into a 3-pane macOS column / Ranger file manager browser (Pane 1: Server, Pane 2: Project, Pane 3: Environment) with inline creation and deletion.
  - **In-App Navigation & Deep URLs:** In-app scope switching was removed in favor of navigating back to the `/servers` multi-column browser. Application URLs are strictly scoped as `/servers/:serverId/projects/:project/environments/:env/...`.
      single mutex acquisition rather than through `deleteCollection`, since its
      per-collection entry and `$ref`-referrer checks are moot when every
      referrer in the scope is being deleted too.
  - **`Storage.listEntryCollections(scope)`** (new port method, both adapters +
    conformance) reports collections that hold entries but no schema. An import
    archive can carry `content/<collection>/` with nothing under `schemas/`;
    those entries are invisible to every schema-derived listing. Two separate
    bugs came from that blind spot, and both are fixed:
    - `DELETE /api/projects/...` returned `204` and changed nothing, leaving a
      scope that `listScopes()` kept reporting and no API call could remove.
      `CollectionEraser.erase` now treats a missing schema as success.
    - `Exporter.exportScope` enumerated content collections from `listSchemas()`
      alone, so those same entries were dropped from **every** archive. It now
      unions schema names with `listEntryCollections()`, which also removes the
      need to name the system collections explicitly — `skipCollection` still
      decides what is allowed out, so `_keys` stays behind `--with-keys`.
  - **`deleteProject` enumerates via `store.listSchemas()`, not
    `Service.listCollections()`.** That helper hides `_`-prefixed names, and
    `Storage.putSchema` has no name validation (only `Service.putSchema` applies
    `Claims.isCollectionName`), so an archive carrying
    `schemas/_secret.schema.json` plants a system-named schema in a *user*
    scope — the schema-side mirror of the entry-only hole above, with the same
    "204 that deletes nothing" outcome. A caller-supplied scope can never be
    `Scope.System` (its ids cannot start with `_`), so erasing `_`-prefixed
    collections found this way cannot reach `_keys`.
  - **Admin UI Multi-Pane Architecture:**
    - The `/servers` manager is now a 3-pane macOS column / Ranger file manager style browser:
      - Column 1: Servers list with add/remove server modals and connection state.
      - Column 2: Projects list within the selected server with inline project creation and deletion.
      - Column 3: Environments list within the selected project with inline environment creation and deletion.
    - Connecting opens the workspace at `/servers/:serverId/projects/:project/environments/:env/collections`.
    - In-app scope switching was removed in favor of navigating back to the `/servers` view.
    - Deep application URLs carry `:serverId`, `:project`, and `:env`.
    - Key management (`/keys/new`) allowed selecting Scope Level: Environment, Project, or All Projects. *Superseded 2026-08-20* by the explicit reach picker, which names the project and env segments separately and adds the fourth shape (one environment across every project).
    - `ApiClient` methods explicitly scope operations with `project` and `env`. Claim checks in the UI pass the active scope.
    `Claims.hasAnyCollectionPermission(claims, perm, project, env)` and
    four-argument `Claims.collection(project, env, name, perm)` — and `NewKey`
    mints collection claims targeting the active scope rather than `*/*/*`.
    `Claims.isScopeId` (shared) is what the UI validates typed ids against, so
    the grammar isn't restated a third time.
  - 129 tests pass across 17 files.

- **Projects & environments, storage-layer scoping (2026-08-18):** a
  collection is now identified by **(project id, env id, collection name)**,
  not name alone — D18 in IMPLEMENTATION.md, superseding D15's revert.
  Projects and envs are plain string-pair containers with no metadata and no
  registry: `Scope` (`apps/server/src/core/domain/scope.ts`) validates ids against the
  same grammar as collection names (`^[a-z][a-z0-9_-]{0,63}$`, defined once,
  not shared with `@silo/shared/claims`), exposes `Scope.System`
  (`_system`/`_system`) and `Scope.Default` (`default`/`default`), and a scope
  "exists" only because it has content — `Storage.listScopes()` derives the
  list from what's actually on disk/in the table, sorted, excluding
  `Scope.System`. There is no `_projects` registry collection.
  - **This phase is storage/domain only.** The HTTP API stays flat: every
    route in `collections-routes.ts`/`entries-routes.ts` passes `Scope.Default`
    explicitly (no default parameter on `Service` methods — the constant is
    the grep target for the API phase that scopes routes from the URL path).
    `@silo/shared/claims` is untouched — the claim grammar does not yet
    encode scope. Media storage stays instance-global. Export/import stay
    instance-wide (no `--project`/`--env` flags yet). All of these are
    explicit deferrals to later phases, not oversights.
  - `Entry` gained `project`/`env` fields alongside `collection`; `Storage`,
    `Service`, `SchemaValidator`/`SchemaBundler`, and the export/import engine
    all take an explicit `Scope` (except key/media/export-import methods,
    which use `Scope.System` internally or stay unscoped). `CollectionEraser`
    and `Service.findSchemaReferrers` are scope-aware, so a `$ref` referrer
    check or a collection delete only ever considers the same scope.
  - **On-disk/export format is now `format_version` `"2"`** (breaking,
    pre-1.0, no migration): the fs layout and export tree moved from flat
    `schemas/`+`content/` to `projects/<project>/<env>/{schemas,content}/...`,
    with `_keys` living at the reserved `projects/_system/_system/...` pair —
    no branch in the adapter, it's stored exactly like any other scope. The
    SQLite `schemas`/`entries` tables gained `project`/`env` columns in their
    primary keys. Both adapters guard against opening a data dir stamped with
    a different `format_version`: `SqliteStore.open` checks `meta.format_version`
    before running DDL and, since that row alone can't rule out a pre-D18 db
    with old-shaped tables and no such row, also inspects `schemas`/`entries`
    directly via `PRAGMA table_info` for a missing `project` column;
    `FsStore.open` checks `manifest.json` before creating anything (a
    refused dir gets no stray `projects/` directory). Both throw an
    actionable message rather than crashing on a missing column or silently
    reading nothing. `seq` stays instance-global and monotonic across every
    scope. `Storage.put`/`get`/`delete`/`list` validate `collection`/`id`
    (and, on `put`, `project`/`env` read off the entry) as safe path segments
    via `EntryUtils.assertSafeSegment` — a port contract both adapters
    enforce identically, not an fs-only concern, because `ImportWalker`
    builds an entry's `id` from archive file *contents*, not the trusted
    archive path. The length cap is **255 bytes** (`Buffer.byteLength`, not
    `.length`): the fs adapter turns these values into filenames, so a looser
    or character-counted cap would let SQLite accept a value that fs rejects
    mid-write with a raw `ENAMETOOLONG` — a divergence the whole point of the
    contract is to prevent, and one a multi-byte unicode id would slip
    through. `listScopes()` on both adapters only reports a scope that
    still holds a schema or an entry (fs actively checks directory contents
    rather than trusting that a directory pair exists) and both skip any
    `_`-prefixed project/env and any row/directory pair that fails `Scope.of`
    instead of throwing and taking the caller down with them.
    `ExportManifest.collections` is now keyed by
    `"<project>/<env>/<collection>"`. `ImportWalker` walks the scoped tree
    only (the flat walkers are gone, not kept alongside); scope and collection
    name come from the archive path, which wins over whatever an entry file's
    own `project`/`env` fields say. Replace-mode import deletes archive
    collections within their own scope only. The fs adapter applies the same
    rule to its own reads: `FsStore.parsedToEntry` takes `project`/`env`/
    `collection`/`id` from the path that located the file and never from the
    envelope inside it. A forged `id` there is not cosmetic — it produced an
    entry `list` returned but `get`/`delete` could not find, which left the
    collection permanently undeletable, since `CollectionEraser` lists and
    then deletes each id it was handed.
  - **Imports are not atomic** (documented in IMPLEMENTATION.md §7.2): a
    rejected segment or a disk error mid-walk leaves prior writes in place
    and returns the error instead of an `ImportResult`. A failed import means
    "unknown state", not "no-op"; `--dry-run` is the way to vet an untrusted
    archive first.
  - Tests: `apps/server/test/core/scope.test.ts` (new) covers id validation,
    `key()`, `equals()`, and `System`/`Default` identity. The storage
    conformance suite (`apps/server/test/conformance/`, run
    against both adapters) gained scope-isolation, cross-scope `seq`
    monotonicity, `listSchemas`/`listScopes` scoping (including pruning a
    scope once its last schema/entry is deleted), the same entry id staying
    distinct across two scopes, system-scope visibility cases, and a
    port-contract case asserting both adapters reject the same malformed
    `collection`/`id`/`project`/`env` values identically.
    `apps/server/test/adapters/fs.test.ts` and `sqlite.test.ts` each gained a
    `describe` block exercising that adapter's data-dir format-version guard
    directly (including, for SQLite, old-shaped tables with no
    `format_version` row at all). `apps/server/test/http/export.test.ts` covers
    an export/import round trip that keeps two scopes' same-named
    collections distinct on both adapters (not SQLite-only), plus rejecting
    a hand-crafted archive whose entry `id` is a path-traversal string and
    confirming nothing is written outside the destination data dir. 113
    tests pass (up from a pre-scoping baseline of 83).
- **Shared claims package (2026-08-17):** claim names, collection permissions,
  validation/normalization, wildcard matching, delegation, presets, and UI
  capability discovery now have one runtime-neutral implementation in the
  local `@silo/shared` package under `shared/`. Both the Bun server and React UI
  depend on that package. The former `apps/server/src/core/keys/ClaimUtils` and
  `apps/admin/src/auth/Claims` implementations were removed, and shared behavior is
  tested under `shared/test/`. Docker copies the local package into both build
  stages before their frozen installs.
  - The root `package.json` declares `"workspaces": ["shared", "ui"]` and every
    consumer depends on `@silo/shared` via `workspace:*`. This matters: with the
    `file:` protocol Bun does not symlink the package directory. At the root it
    **copied**, so the server kept running a stale snapshot after every edit to
    `shared/` while `shared/test/` (which imports by relative path) tested the
    new code — one `bun test` run could report green on two different versions.
    From `ui/` it mirrored the package as **per-file** symlinks, an install-time
    snapshot: edits to an existing shared file propagated, but a newly added one
    stayed invisible until a reinstall. Workspaces symlink the directory itself,
    so every member always sees the same source, new files included.
  - Errors that cross this boundary are identified by **brand, not
    `instanceof`**. `ValidationError` carries a `brand` field and a static
    `ValidationError.is()` guard, and every catch site uses it. `instanceof`
    would compare prototype identity, which holds only while exactly one copy of
    the module is loaded — the same install-layout assumption the two bullets
    below describe. A guard test asserts `@silo/shared` resolves to one on-disk
    copy from every install root, so a regression fails loudly instead of
    silently turning 400s into 500s.
  - Whole claims are typed. `Claim` (`packages/shared/src/claims/claim.ts`) is the union of
    root, `FixedClaim`, and `CollectionClaim`, and it is what `Claims.has`/`any`/
    `canDelegate` and `RouteAuth.requireClaim` accept. The `Claims.Collection*`
    constants are bare `CollectionPermission` fragments (`"entries:read"`), not
    claims; before this typing they satisfied a `string` parameter and turned
    into a silent permanent deny. Scope them with `Claims.collection(name, perm)`.

- **Production container refreshed (2026-08-14):** the Docker build pins its
  Bun version alongside the release workflow's (one number, two files, and a
  comment in each saying so), installs from the committed root `bun.lock` with
  `--frozen-lockfile`, and runs as the unprivileged `bun` user. The
  default filesystem blob path is `/data/media`, so an explicit runtime mount
  at `/data` persists both SQLite data and media (including Railway Volumes;
  the Dockerfile intentionally has no `VOLUME` instruction because Railway
  rejects it). The runtime image also exposes a Docker health check backed by
  `GET /api/health`; the build context excludes root dependencies and server
  tests.
- **Repo restructure (2026-08-13):** `src/` and `test/` are gone. Server code
  now lives under `server/` (sibling to `ui/`), tests under `apps/server/test/`.
  The move was purely mechanical — one exported artifact (class, interface,
  standalone function, React component) per file, grouped into feature
  directories (`packages/shared/src/claims/`, `apps/server/src/core/{domain,ports,query,errors,schema,keys,media,transfer,service}/`,
  `apps/server/src/adapters/{storage/sqlite,storage/fs,blob,http}/`, `apps/server/src/http/{routes,auth,middleware}/`,
  `apps/server/src/cli/{,commands}/`, `apps/server/src/config/`; `apps/admin/src/{api,api/types,schema,components,forms,router,styles,utils,views/*}/`).
  No behavior changed. See the Repo map and Code Design Rules sections below
  for the new layout.
- **UI styling is owner-scoped (2026-08-13):** the former 2,859-line
  `apps/admin/src/styles.css` monolith is deleted. React components, RJSF artifacts,
  and feature views now own colocated `*.module.css` files; shared visual
  primitives such as buttons, segmented controls, modals, and data tables live
  under `apps/admin/src/components/`. Only tokens, the document reset, cross-screen
  page/form primitives, feedback, and a short utility list remain global under
  `apps/admin/src/styles/`. Stylelint runs as part of `bun run lint` and catches invalid
  CSS, duplicate declarations, selectors, and keyframes.
- **Dead code removed (2026-08-13):** `apps/admin/src/views/keys/KeyGate.tsx`, the old
  single-key login gate, is deleted — nothing imported it since multi-server
  support replaced it with `ServerManager` (`apps/admin/src/views/servers/ServerManager.tsx`),
  which is the welcome screen shown on first visit and after any `401`.
  IMPLEMENTATION.md's key-gate mentions (§8 auth, §9 layout/view 1, M3) now
  describe the server manager. KeyGate's orphaned styling was removed; the
  welcome screen is fully owned by `ServerManager.module.css`.
- **Phase: Pluggable Blob Adapter Pattern & S3 Support Complete.**
  - Media/file storage is fully abstracted behind a pluggable `BlobStorage` interface (`apps/server/src/core/ports/blob-storage.ts`).
  - **Blob Storage Adapters:**
    - **Filesystem Adapter (`FsBlobStorage`):** Stores media files locally in a directory that follows the data dir (`<data>/media`) unless one is named explicitly. Default behavior.
    - **S3 Adapter (`S3BlobStorage`):** Uses Bun's built-in `S3Client` to support AWS S3 and S3-compatible providers (MinIO, Cloudflare R2, DigitalOcean Spaces, etc.). Path-style addressing is opt-in via `force_path_style`; `list()` follows continuation tokens.
    - **Driver selection (`ProviderRegistry`, D31):** Configured via `[blob_storage]` in `silo.toml` or `SILO_BLOB_*` environment variables.
  - **Export/Import Media Portability:** `Exporter` and `Importer` use `BlobStorage` to seamlessly export and import media files across any backend.
- **Direct server copy is available:**
  - A key with `transfer:copy` can pull a complete export from another running silo through `POST /api/copy` or the admin UI's **Data transfer** view.
  - The source URL and a source key with `transfer:export` are required. Copy composes the existing export/import engines, supports merge or replace with a dry-run preview, and includes schemas, entries, and media.
  - **Data only** preserves destination API keys. **Data + API keys** exports the source `_keys` hashes; replace mode replaces destination keys and the UI switches its saved destination credential to the supplied source key after success.
  - Data-plus-keys additionally requires `keys:export` on the source and `keys:import` on the destination.
  - `apps/server/src/adapters/http/http-silo-client.ts` owns source HTTP access. Source credentials are held only for the request and are never persisted by the destination server.
- **Phase: TypeScript/Bun/Hono migration complete, plus multi-server support.**
  - The Go backend has been fully migrated to TypeScript, running natively on **Bun** and using the **Hono** web framework.
  - Storage is pluggable via a common `Storage` interface in TypeScript:
    - **SQLite adapter** uses `bun:sqlite`.
    - **Filesystem adapter** stores collections and schemas in a flat layout on disk.
  - **Multi-Server Support:** The backend projects nesting has been reverted in favor of flat collections namespaces (API endpoints `/api/collections...` without route prefixes). The frontend UI dynamically manages a list of active servers in the browser's `localStorage` and lets users switch between them.
  - API keys carry explicit capability claims; the old role/collection-allowlist key format is intentionally unsupported.
  - Export `format_version` is `"1"` (flat on-disk layout: `schemas/...`, `content/...`).
  - The Admin UI has a clean welcome screen with server configuration forms, letting users manage, delete, and connect to multiple silo instances.
  - A comprehensive conformance test suite translated to `bun test` ensures matching behavior across storage backends, blob adapters, and export/import round-trips.

- **Schema references (`$ref`) are supported end to end:**
  - Schemas can reference other collections via `silo://collections/<name>` (every collection schema is registered in Ajv, so refs — including recursive ones — resolve locally) or remote `http(s)` URLs.
  - **Schema Bundling (`SchemaBundler`):** Upon saving or updating schemas, `Service.putSchema` automatically fetches referenced local and remote schemas and embeds them into `$defs`. The property's original reference URL (`silo://collections/<name>` or remote URL) is preserved, making the schema document self-contained.
  - Remote refs are **rejected by default** with an actionable error naming the fix; the `[schema] allow_remote_refs` config key (env `SILO_SCHEMA_ALLOW_REMOTE_REFS`) opts in. When enabled, `SchemaValidator` compiles with `ajv.compileAsync` and `RemoteSchemaLoader` fetches missing refs (http/https only, 10s timeout, in-memory cache cleared on schema change).
  - Deleting a collection that another schema `$ref`s fails with `409` unless forced (`Service.findSchemaReferrers`).
  - The visual schema builder offers a **Reference** field type: a local-collection dropdown or a remote-URL input. For entry forms, `SiloRefs.resolveForForm` (`apps/admin/src/schema/silo-refs.ts`) inlines referenced collection schemas under `$defs` keyed by their silo URL and rewrites refs to internal `#/$defs/...` pointers, because RJSF's renderer and ajv8 validator only follow internal pointers. Remote, unknown-collection, and cycle-closing refs become permissive marker nodes (`x-silo-unresolved-ref`) rendered as the raw-JSON fallback field — the server stays authoritative for those.
