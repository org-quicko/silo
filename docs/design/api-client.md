# TypeScript client

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 14. The TypeScript client (D61)

`packages/silo-client`, published to npm as `silo-client`. A typed,
object-oriented client for the data half of silo's HTTP API: projects,
environments, collections, schemas, entries, queries, variables, search and
media. Zero runtime dependencies, ESM and CJS, Node 18+ / Bun / Deno /
browsers / workers.

It is flat under `packages/` rather than nested at `packages/api-client/typescript/`
for one mechanical reason: the root `package.json` declares
`workspaces: ["apps/*", "packages/*", "plugins/*"]`, so a package two levels
deep is not a member — `bun install` would not link it, `@silo/shared` would
not resolve in its tests, and `tsc -b` at the root would not see it. A second
language client becomes `packages/silo-client-python/` and nothing moves.

### 14.1 The path is the object graph

The API's own shape is a path, so the client is that path as handles:
`silo.project("acme").environment("prod").collection<Post>("posts").get(id)`.
Handles are value objects that make no request, so nothing in a chain needs an
`await` until the call at the end.

The alternative — the shape the admin UI's own client has — is a flat client
whose every method takes the whole address: `api.entries.get(url, key, scope, collection, id)`.
That is five positional arguments before the first interesting one, and it is
what a client for this API converges on unless the address is modelled.

**There is no default scope**, and both names are always explicit. A client
that defaults to `default/prod` — silo's own `Scope.Default` — would read the
wrong environment silently on any instance that has more than one, and silence
is the failure mode that costs content. `silo.scope(project, environment)` is a
shortcut for the two-call chain and still takes both names.

Handles are also **immutable**: a rename does not repoint the handle that
performed it, and a child handle built from the old name keeps addressing the
old name. That reads as a rough edge until you consider the alternative, which
is a handle whose meaning changes under a caller holding it, and child handles
silently repointed at a path they were not built for. A `NotFoundError` from a
stale handle is the honest outcome, and building a handle for the new name is
one line.

### 14.2 A resolved read is not editable

This is the decision the rest of the client is arranged around.

Every `{{NAME}}` an entry holds is substituted on the way out (D57), and
resolving is the default because an app reading content should not have to opt
in to a usable value. That makes the default read the wrong thing to write
back: an entry storing `url: "{{API_URL}}/posts"` comes back holding
`https://api.acme.com/posts`, and saving it replaces the reference an author
typed with a snapshot of what it happened to mean. The admin UI already knows
this and asks for `?variables=raw` on every single read for exactly this
reason.

Documenting "an editor should ask for raw" leaves the mistake available, so the
type system removes it instead. `collection.get(id)` answers a `ResolvedEntry`,
which carries `delete()` and **no `save()`** at all; `collection.edit(id)`
reads raw and answers an `Entry`, which has `save()` and `refresh()`. Which of
the two you are holding is therefore a compile-time fact rather than a
convention.

The editable half is a whole read surface, not one method: `collection.editable`
answers `get`, `list`, `all` and `pages`, each reading raw and each answering
an `Entry`. A tool editing a page of entries needs that, and `edit(id)` is the
one-entry shorthand over it.

Writes always send `?variables=raw`, whichever surface they were called on, so
a create or a replace echoes back what was sent. Without that, the same failure
returns one step later: a create response holding substituted values, held and
saved, overwrites the template the caller just wrote.

**Both surfaces are concrete classes, and there is no mode.** The first cut put
`variables` on `SiloOptions` and threaded the choice as a type parameter from
`Silo` through `ProjectHandle` and `EnvironmentHandle` into
`CollectionHandle<Fields, Mode>`, with a conditional `EntryFor<Fields, Mode>`
deciding what a read answered. It worked, and it was the wrong trade: a type
parameter that appears in four class signatures and every return type is the
most prominent thing in the API, and what it bought was one construction-time
setting. Naming the surface at the call site says the same thing where it is
read. Deleting it removed the `Mode` parameter from four classes, the
`EntryFor` conditional, `VariablesMode` itself, and the mode argument `Search`
carried, and the shared paging moved into one `EntryReader<Row>` that each
surface instantiates with its own wrapper.

A runtime `variables` option could not survive that change: without the type
parameter, `get()` would claim a `ResolvedEntry` while holding raw data, which
is a worse lie than the one this section exists to prevent.

The cost is a second entry type and a second read surface. The alternative
candidates were both worse. Making `raw` the global default undoes D57 for
every consumer that is not an editor. A runtime guard on `save()` moves the
error from the compiler to production.

### 14.3 An entry owns its revision

`PUT` and `DELETE` on an entry require the revision the caller expects
(`?rev=`), and a mismatch is a `409`. That is the correct protocol and it is
the most error-prone part of this API to consume, because the number has to be
threaded from a read to a write through whatever the caller's own state layer
is.

So the entry object holds it. `save()` sends the rev it holds, adopts the rev
and timestamps it gets back, mutates in place and returns itself; a `409` is a
`ConflictError` and `refresh()` is the recovery. A caller never writes a
revision down.

Two consequences worth stating. A second overlapping `save()` on one instance
is refused locally rather than sent, because the second would carry a rev the
first has already superseded and the local message names the bug better than a
`409` does. And a mutable object is hostile to React state, so `toJSON()` is
first-class rather than an afterthought: it answers the flat wire shape, which
is what belongs in a store.

Fields live under `entry.fields` rather than spread onto the instance, so a
field named `save` or `rev` cannot shadow a method or the envelope. The promise
is narrow and the client says so: it prevents collisions with the **client's**
members, not with the wire's. `EntryUtils.toApiResponse` deletes user fields
named `id`, `rev`, `seq`, `created_at` and `updated_at` before answering, so
those five never survive a read and no client can reconstruct them.
`ReservedFieldNames` exports the list and `Collections.create` warns when a
schema declares one. Fixing that properly needs an enveloped entry response
from the server, which is a server decision and not this package's to make.

### 14.4 Pagination navigates by the window the server answered

`QueryUtils.normalizeQuery` **clamps**: a `limit` over 500 becomes 500, a
non-positive one becomes 50, and a negative offset becomes 0 — all silently. A
client that paged by the limit it asked for would therefore step over 400
entries per page on a request for 900, and report a total it never covered.

So every page carries the window as answered, and `next()` advances by that.
The requested window is used for exactly one thing: sending the request.

`hasMore` and `pageCount` are honest about which fact they rest on.
Ordinarily `offset + rows < total`. On a `truncated` search — the portable
engine stopped at its visit cap, so `total` counts what was examined rather
than what exists — `pageCount` is `null` and `hasMore` falls back to "this
page came back full". A media usages page is the third case: the wire answers
`total` (the true referrer count), `visible` (what this key may read) and
`visible_capped`, and echoes no window at all, so the page exposes all three
numbers and derives its own count from `visible`, which is the ceiling its
rows can reach.

`all()` and `pages()` are async iterables that page lazily and stop on the
first short or empty page. Offset iteration over data being written is not a
snapshot and the doc comment says so, rather than implying a consistency the
protocol cannot offer.

### 14.5 Filters are built, and a typed collection types them

The query AST is a small JSON structure (D29) and it is correct, but nobody
should type `{"op":"eq","path":"$.data.status","value":"published"}`.
`Filter.field("status").equals("published")` emits it, `Filter.each("tags")`
writes the `[*]` wildcard so nobody has to, and `Filter.meta("updated_at")`
addresses the envelope. The two spellings of a wildcard predicate make the
subtlety the API documents visible at the call site:
`each("tags").notEquals("x")` is *some tag is not x* and
`not(each("tags").equals("x"))` is *no tag is*.

`collection<Post>("posts").filter` is the same surface typed to `keyof Post`,
so `filter.field("stauts")` does not compile. An untyped `Filter` static stays
for a filter assembled from user input at runtime, and `Filter.raw(node)` is
under both. `each` unwraps one array level when it types the operand, since
`each("tags")` on `tags: string[]` must accept a `string`.

Sorts are named for the field rather than for a vague idea of recency:
`Sort.recentlyUpdated()` and `Sort.recentlyCreated()` are different orders and
a single `newest()` hid which one it meant. `Sort` offers no `each`, because a
sort path must select at most one node.

### 14.6 Only known metadata is renamed

The client uses one naming convention internally, so `requires_auth` reads as
`requiresAuth`, `set_in` as `setIn`, the timestamps as `Date`s named
`createdAt` and `updatedAt`, and a search hit's `env` as `environment`.

Every one of those is an **explicit entry in a per-type mapper**, never a
transform over unknown keys. A recursive camel-case pass would rewrite a
customer's `product_code` field, rename the schema properties that validate
it, and break `{{API_URL}}`. Content, JSON Schema property names and variable
names are never touched, and a test asserts it.

### 14.7 Four kinds of failure, and what a write's outcome is not

`SiloError` is the base for anything silo answered and refused, with one
subclass per wire code so a caller branches on a type rather than reading a
string. `media_in_use` is one of them, and its `details` is an object rather
than a validation list, so `MediaInUseError` carries `usageCount`,
`visibleCount`, `visibleCapped` and mapped `referrers`.

`NetworkError`, `TimeoutError`, `RequestAbortedError` and
`InvalidResponseError` deliberately do **not** extend `SiloError`, because
nothing answered. Telling a deadline from a caller's `abort()` from an
unreachable host needs the composed signal to remember which source fired,
which is what `AbortSignals` is for; `AbortSignal.any` would have done it and
Node 18 does not have it.

Nothing is retried. A retried `POST` to a collection is a duplicate entry and
a retried `409` is wrong by definition, so retry policy belongs to the only
layer that knows whether a call was idempotent. For the same reason a
`NetworkError` on a write does not claim the write failed: the request never
landed, which is not evidence about what the server did, and the message says
to reconcile rather than to retry.

### 14.8 Verification is the packed tarball

`bun test` against `src/` cannot establish "runs everywhere". It cannot tell
you whether the `exports` map resolves, whether a CommonJS consumer's types
load, or whether an upload works in a browser bundle.

So the package ships `tools/packaged-tests.ts`: it builds, asserts all four
`dist` entry points exist, runs `npm pack`, then `publint` and
`attw --pack` over the artifact, then installs the tarball into throwaway Node
ESM, Node CommonJS and Bun consumers and runs a real script in each. A missing
tool reports as skipped rather than passing.

That harness earned its place immediately: the first build of this package
produced two broken artifacts, and both passed every unit test.

**`"sideEffects": false` made `bun build` emit a bundle that exports names it
never defines.** With the field set, an entry point consisting only of
re-exports is tree-shaken to nothing: `dist/index.js` came out at 0.9 KB, a
bare `export { ... }` list over an empty module, and `import()` failed with
"Export 'CollectionHandle' is not defined in module". The same barrel built to
60 KB with the field removed, and `export * from` was unaffected, which is what
localised it. Bun offers no way to ignore the annotation while bundling, so the
field is **deliberately absent** from `package.json` rather than forgotten. The
cost is small and worth naming: `sideEffects` mainly lets a consumer's bundler
skip whole modules, and this package publishes one bundled file per condition
that a bundler already tree-shakes by static analysis.

**Every relative import in `src/` carries a `.js` extension.** Extensionless
specifiers are fine under `bundler` resolution and fine at runtime, but `tsc`
emits them verbatim into the declaration tree, where `node16` and `nodenext`
consumers reject them (TS2834). A consumer typechecking with
`skipLibCheck: false` saw an error for every relative import in every emitted
`.d.ts`. Writing `./x.js` in the source resolves to `x.ts` under both TypeScript
and Bun, and emits a specifier a Node-resolution consumer can follow.

`attw` then found a third: with `exports` alone and no top-level `main` or
`types`, a resolver that predates `exports` could not find the package at all,
so `node10` reported a resolution failure while every modern condition passed.
The three fallback fields are set alongside `exports`, which still wins
everywhere it applies.

Declarations are emitted **per condition**: `index.d.ts` and
`index.d.cts`. One `.d.ts` serving both is TypeScript's own documented failure
mode under `node16` and `nodenext`, and `attw` is what catches it mechanically.
Copying only the entry point is not enough either, which was the third thing
the check found: its relative imports would still land in the ESM tree, so a
CommonJS consumer would read ESM declarations for every type behind the entry.
`tools/emit-cts-types.ts` mirrors the whole tree and rewrites `./x.js` to
`./x.cjs`. Both conditions are verified by typechecking a real consumer, an
`.mts` and a `.cts` file, against the packed layout under `node16` with
`skipLibCheck` off.

The client declares its own wire types rather than importing `@silo/shared`.
That package is `private: true` and its exports point at `.ts` source, so a
published package cannot depend on it — but the better reason is that the wire
is a public contract that should not silently follow an internal refactor.
`@silo/shared` stays a dev-only dependency, used by a drift test asserting the
two `FilterNode` and `ValidationDetail` shapes stay structurally assignable.
Its being a devDependency is also why it reaches no consumer.

`RouteInventory` lists every route the client covers and is checked against the
server's own registrations, not against `docs/guide/http-api.md`. The guide was
missing `GET` and `POST /api/media/folders`, `GET /api/media/{id}/usages` and
the `media_in_use` code when this package was written — it is corrected now,
but a drift guard reading a document that can be incomplete is false
confidence.

### 14.9 What the client deliberately does not reach

Keys, claims, plugins, transfer, settings, audit, observability, session
introspection, search reindex, media purge and media reconcile. Each is an
operator action reachable from the admin UI, and none of it is content. There
is also no generic `request()` escape hatch: without one, a route the client
does not cover is a client change, which is the point of `RouteInventory`.

An enveloped entry response — the thing that would let a field be named `rev`
— is a server change and is not attempted here. Neither is caching, retries,
or a framework adapter: the client stays framework-neutral so a React or Nuxt
package can wrap it without forking it.

The admin UI keeps its own `src/api/` for now. The client is shaped so
`apps/admin` can adopt it, and §14.2's split is what would make that swap
safe, but it touches around forty view files and is its own change.
