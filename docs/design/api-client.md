# TypeScript client

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 14. The TypeScript client (D61)

`packages/silo-client`, published to npm as `@org-quicko/silo-client`. A typed,
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

### 14.2 An entry is the wire's own row

This is the decision the rest of the client is arranged around, and it is the
opposite of the one D61 made. It replaces the `ResolvedEntry`/`Entry` split
wholesale (D62).

A read answers exactly what the API answered: the author's fields and the
envelope's four keys in one flat object, nothing renamed, nested or wrapped,
`created_at` still spelled `created_at` and still a string. A row carries no
transport, no scope, no prototype and no methods, so it logs as its own
contents, survives `structuredClone`, and drops into a store or React state
as-is.

**Why the split existed, and why it stopped paying.** Resolving `{{NAME}}` is
the default on the way out (D57) and must stay so, since an app reading content
should not opt in to a usable value. That makes the default read the wrong
thing to write back: an entry storing `url: "{{API_URL}}/posts"` comes back
holding `https://api.acme.com/posts`, and writing it replaces the reference an
author typed with a snapshot of what it meant that day. D61 reasoned that where
a mistake cannot be corrected after the fact the affordance should not exist,
and removed `save()` from the type a resolving read answers.

The reasoning was right and it solved the wrong layer. The hazard was never
"holding a resolved value"; it was `entry.save()` specifically, a method that
writes back a value the caller acquired without choosing how it was read. Take
the method away and there is nothing left to withhold: `posts.replace(id, rev,
fields)` names the fields being sent at the call site, so sending a resolved
value is a thing a caller types rather than a thing that happens to them. Two
classes, two read surfaces, an `EntryFor` conditional and a mode parameter were
all in service of a guard that the write signature now provides for free.

**What the split cost while it stood.** An entry had to reach the network to
offer `save()`, so every row carried an `EntryContext` holding the `Transport`,
and `protected` is a compile-time fiction: at runtime `context` was a plain
enumerable own property. So `console.log(entry)` printed the instance's API key
in full, on every row of every list, into any logger or error report that
inspects an object. `toJSON()` was clean and nothing else was. That is not an
argument against active records in general, but it is what this one did, and it
was found the ordinary way, by someone printing a row.

**What survives.** The raw-versus-resolved choice, because an editor still has
to read the template it is about to edit. It is a per-call option now,
`{ variables: "raw" }`, accepted by `get`, `list`, `all` and `pages`, rather
than a second class hierarchy. Writes always send `raw` whichever way the row
was read, or the same failure returns one step later in a create's echoed body.
The option is the smallest thing that can express the choice, which is what
D61's own argument against the `Mode` type parameter should have concluded.

### 14.3 The revision is passed, not held

`PUT` and `DELETE` require the revision the caller expects (`?rev=`) and a
mismatch is a `409`. That is the correct protocol and the most error-prone part
of this API to consume, because the number has to survive the trip from a read
to a write.

D61 put it inside the entry so a caller never wrote it down. The price was an
object that had to carry a transport in order to spend it, which is the whole
of 14.2. So the revision is a parameter again: `posts.replace(id, rev, fields)`
and `posts.delete(id, rev)`, with `rev` the one the row answered. A
`ConflictError` and a fresh read are still the recovery, and the row a read
answers still carries the `rev` the next write needs, so nothing is written
down that was not written down before. What is given up is the `entry.save()`
spelling and the local refusal of a second overlapping `save()` on one
instance, which was a guard against a mistake only the mutable object made
possible.

Fields sit at the row's top level rather than under `entry.fields`. D61 nested
them so a field named `save` or `toJSON` could not shadow a member; there are
no members now, and the envelope's own five names are refused by silo where
data enters (D62), so the collision the nesting guarded against cannot occur at
either layer. The client therefore holds no reserved-name list of its own and
no create-time warning: silo owns the rule, answers a `validation_failed`
naming the field, and a second copy of the list in the client is a second thing
to drift.

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

Around the **metadata** types the client uses one naming convention, so
`requires_auth` reads as `requiresAuth`, `set_in` as `setIn`, a collection
summary's timestamps as `Date`s named `createdAt` and `updatedAt`, and a search
hit's `env` as `environment`.

Every one of those is an **explicit entry in a per-type mapper**, never a
transform over unknown keys. A recursive camel-case pass would rewrite a
customer's `product_code` field, rename the schema properties that validate
it, and break `{{API_URL}}`. Content, JSON Schema property names and variable
names are never touched, and a test asserts it.

**An entry is not one of these types** (D62). Its row is the wire's, untouched,
`created_at` included, because the convention was bought at the price of a
mapper in each direction and a row that could no longer be handed back to the
call it came from. A search hit keeps its `environment` rename because the hit
is the client's own structure; the entry inside it is not.

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

`POST /api/media/{id}/content` joined it with D67, as `MediaAsset.replace()`.
It is a method on the asset rather than on `Media` because a replace has a
subject that already exists, which is the same reason `rename`, `moveTo` and
`delete` live there: `Media` is how you find or add an asset, `MediaAsset` is
what you do to one. It adopts the server's answer in place like every other
mutating call, so `hash`, `sizeInBytes` and `contentType` move while `id`,
`reference` and `url` do not — which is the property the class doc already
warns about from the other direction, that `url` is where to fetch today's
bytes and `reference` is what belongs in an entry. `MediaFile` holds the
blob-and-filename derivation that `Media.upload` had inline, because the
server reads the extension off that name on both paths and two spellings of it
could disagree about what is being sent.

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
