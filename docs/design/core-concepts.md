# Core concepts

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 5. Core concepts

### 5.1 Entries and the envelope

An entry is user data (`data`) wrapped in a silo-owned envelope. Since D18, a
collection is identified by `(project, env, collection)`, not name alone, so
the envelope carries the scope alongside the collection name it already
carried:

```go
type Entry struct {
    ID         string          `json:"id"`          // ULID
    Project    string          `json:"project"`     // scope; "_system" for silo-reserved data
    Env        string          `json:"env"`         // scope; "_system" for silo-reserved data
    Collection string          `json:"collection"`
    Rev        int64           `json:"rev"`         // per-entry, increments on every write
    Seq        int64           `json:"seq"`         // per-instance monotonic write counter, global across every scope
    CreatedAt  time.Time       `json:"created_at"`  // RFC3339, UTC
    UpdatedAt  time.Time       `json:"updated_at"`
    Data       json.RawMessage `json:"data"`
}
```

- `rev` enables optimistic concurrency (§8) and merge conflict resolution (§7.2).
- `seq` is the hook for a future change feed (§12.1). It costs nothing now and avoids a storage redesign later. It stays instance-global rather than per-scope, so a single cursor still orders every write in the instance.
- Timestamps are always UTC RFC3339 with millisecond precision.
- `project`/`env` follow the same id grammar as collection names
  (`^[a-z][a-z0-9_-]{0,63}$`), defined once on the `Scope` value object
  (`apps/server/src/core/domain/scope.ts`, D18). `Scope` is a plain (project, env) pair
  with no metadata and no registry — see D18 and §6.1.
- `EntryUtils.toApiResponse` never leaks `project`/`env` into the HTTP
  response, exactly like `collection` and `seq`: scope is a storage/domain
  concern, invisible to the API. `rev` **is** returned (2026-08-20), because
  §8 requires it back as `If-Match`/`?rev=` — a client that never sees a
  revision can only guess one, which succeeds exactly once per entry and then
  `409`s on every later write. A user field named `rev` is dropped from the
  data the same way `id` already was, so the envelope value cannot be
  shadowed.

### 5.2 Collections & schemas (full JSON Schema)

A collection = a name + a JSON Schema draft 2020-12 document. Schemas are stored *through the storage adapter* (so the UI can edit them) and exported as plain files (so git workflows work).

Since D51 a collection is a **keyed record**: a ULID that never changes, and a
`name` that is a mutable label, unique within its environment. The schema is not
a separate row — `collections` replaced the `schemas` table rather than joining
it, because two tables would give "does this collection exist" two answers that
can drift apart. The `schema` column is **`NOT NULL`**: a collection cannot
exist without one, `putSchema` is the only thing that brings a record into being
and `deleteSchema` is what ends it. Two consequences follow and are stated here
rather than discovered in the field. An import carrying `content/<name>/` with no
`schemas/<name>.schema.json` is **refused by name** — silo used to accept it, and
inventing a permissive `{"type":"object"}` to satisfy the column would silently
accept anything into a collection the operator believes is validated. And
`Storage.put` **refuses an entry whose collection has no record**: a project and
an environment are pure containers and are still created implicitly, but nothing
implicit can invent a schema. That state was never reachable through the HTTP
API, which has always required a schema to create a collection; it was reachable
only through import and a direct `put`, and it was the reason two enumerations
(`listSchemas` and `listEntryCollections`) existed everywhere one would do.

Renaming a collection is therefore a one-row update — but not *only* that, because
`$ref`s still address collections by **name**. The rename repoints every
referring schema, self-references included, and rebuilds the `$defs` keys
`SchemaBundler` derives from collection names by stripping and re-bundling rather
than patching. See §8 for the route and its authority.

**Validation** — full spec compliance via `github.com/santhosh-tekuri/jsonschema/v6` (complete 2020-12 support). Compiled validators are cached in memory, invalidated on schema update.

**`$ref` policy** — refs resolve only against: (a) the same document (`#/$defs/...`), (b) other collections in this instance via `silo://collections/<name>`. **Remote http(s) refs are rejected by default** (opt-in via config) — network fetching during validation is a determinism and security hazard, and would break offline imports.

**Form rendering** — RJSF handles most of the spec (including `oneOf`/`anyOf`/`$ref`), but full JSON Schema is not fully renderable as a form. Policy: RJSF renders what it can; for constructs it can't, the UI falls back to a **raw JSON editor with live validation** for that subtree. Validation is always authoritative server-side regardless of what the form allowed.

**Schema changes vs existing data** — validation happens **on write only** (lazy). Changing a schema never blocks on or rewrites existing entries; entries that predate a schema change may no longer validate and will be flagged in the UI when opened. A `silo validate` command (roadmap) can sweep a collection on demand. This is the only sane policy under a document model with replayable imports.

`x-silo-*` extension keywords are reserved for silo (UI hints like field ordering/widgets, future relation semantics). Unknown `x-silo-*` keys are preserved, never stripped.

### 5.3 Query AST and paths (D29)

Queries are a small structure, not a string language. Every op added must be implemented by every adapter forever, so the set is deliberately minimal. Since D29 the *addressing* half is not silo's own invention either: fields are **RFC 9535 JSONPath** expressions.

```json
{ "op": "and", "args": [
    { "op": "eq",     "path": "$.data.tags[*]",   "value": "cms" },
    { "op": "gte",    "path": "$.updated_at",     "value": "2026-01-01" },
    { "op": "not",    "args": [ { "op": "exists", "path": "$.data.archived_at" } ] }
] }
```

A query is that filter plus `sort` (paths with an optional `-` prefix for descending), `limit` (default 50, max 500) and `offset`.

**Operators.** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains` (leaf); `exists` (leaf, no value); `not` (exactly one arg); `and`, `or`. `contains` is **string substring only** — array membership is `eq` over a `[*]` path, which is why no operator needs an array branch.

**The path subset is closed.** Root `$`, name selector, array index (negative included), child wildcard `[*]` and `.*`. Recursive descent, slices, index unions, filter selectors, function extensions and script expressions are **refused** by the parser, not ignored. Excluding recursive descent is what keeps `json_tree()` — a full-subtree walk — out of the SQL compiler; `json_each()` covers the child wildcard far more cheaply.

**The root is a virtual entry document.** Paths address `{ id, rev, created_at, updated_at, data }`:

| Path | Addresses |
|---|---|
| `$.id`, `$.rev`, `$.created_at`, `$.updated_at` | the envelope fields the API returns |
| `$.data.author.name`, `$.data.items[0]`, `$.data.items[-1]` | singular paths into user data |
| `$.data.tags[*]`, `$.data.meta.*` | wildcard paths, zero or more nodes |

The envelope half is exactly what `EntryUtils.toApiResponse` exposes; user fields sit under `$.data` rather than flattened as the wire response has them, so a user field named `id` can never shadow the envelope's. `project`, `env`, `collection` and `seq` are unaddressable because the API hides them (§5.1) — derived from one rule, not restated as a second allow-list. An envelope field is a scalar and takes no further selectors: `$.id[0]` is a parse error, not an empty result. The pre-D29 spellings (`author.name`, `$id`) are gone, with no shim and no detection.

**Cardinality is part of the contract.** A singular path selects zero or one node; a wildcard path selects zero or more. A leaf op is true when **any** selected node satisfies it. **ANY over zero nodes is false — for every op, `neq` included.** `exists` is true when the path selects at least one node. `not` negates the completed child predicate. Sort accepts singular paths only, since a wildcard has no deterministic order.

Two consequences worth stating outright, because both look like the other:

| Written | Means |
|---|---|
| `neq($.data.tags[*], "x")` | at least one tag is not `"x"` |
| `not(eq($.data.tags[*], "x"))` | no tag is `"x"` |

and "absent, or not equal" is now explicit: `or(not(exists(p)), neq(p, v))`. Pre-D29, `neq` on a missing field returned true; it returns false now.

**One parser, three consumers.** The path AST and parser live in `packages/shared/src/query/path/` because the admin UI (filter builder), the query validator and both engines must agree on what a path means. The `Filter` node and the closed operator list (`packages/shared/src/query/filter.ts`, `filter-ops.ts`) live there for the same reason and are read by the same three: an op the UI offers but the validator refuses would be a `400` the reader cannot act on, and the only way that cannot happen is for the menu and the validator to read one list. Only the SQL compiler is adapter-local. SQLite compiles a singular path to `json_extract(data, '$.a.b')` and a wildcard to `EXISTS (SELECT 1 FROM json_each(data, '$.items') WHERE …)`; the fs adapter walks the same AST in memory. `exists` on a singular path is `json_type(data, '$.p') IS NOT NULL`, which distinguishes JSON `null` (exists) from absent. `not` compiles to `NOT COALESCE(<cond>, 0)` and never to a bare `NOT`: SQL three-valued logic drops NULL rows, so a bare `NOT` disagrees with the in-memory evaluator on exactly the missing fields a negation is usually asked about.

### 5.5 Search (D30)

Search is a separate port, not an operator. §5.3's "every op is forever" rule is the reason: an FTS operator would oblige every future adapter to reproduce relevance ranking, whereas a port lets each answer with what it has.

```
Searcher.search(request, access)   ->  { data: hit[], total, limit, offset, truncated, engine }
Searcher.reindex(target?)          ->  report
Searcher.capabilities()            ->  { engine: "fts5" | "scan", snippets }
```

Two implementations. **`ScanSearcher`** works on every adapter by reading entries and matching in memory — O(N), the character §6.3 already commits the fs adapter to. **`SqliteSearcher`** uses FTS5. The portable one ships first, so search exists everywhere and FTS5 makes it fast rather than possible. It stops at a visit cap **and** a time budget, reporting `truncated` — a count cap alone is not enough, because one collection of very large documents exhausts a request's patience well before its entry count. Both are checked per entry rather than per page, or a single page could overrun the cap by its whole size. FTS5 is probed at open inside a savepoint; a build without it falls back to the scan engine and logs once, because the shipped SQLite sets `OMIT_LOAD_EXTENSION` and no runtime repair is possible.

**What gets indexed** is derived by the caller — the extractor needs the schema, the adapter must not have it. It reaches an adapter through the port (`Storage.put(e, { usages, search })`), exactly as media usages do (D23), from the point an engine actually stores it; `ScanSearcher` extracts at query time and needs no stored text. An `x-silo-search` keyword at the schema root selects the text with D29 paths:

```json
"x-silo-search": {
  "label":   ["$.data.title"],
  "include": ["$.data.blocks[*].text"],
  "exclude": ["$.data.internal_notes"]
}
```

`label` is the high-weight bucket (`bm25(fts, 10.0, 1.0)`); `include`, when present, becomes an allow-list that replaces the default; `exclude` subtracts. With the keyword absent the default is every string leaf under `$.data` and an empty `label`. Paths are validated when the schema is saved, so a typo is a `400` rather than a field that quietly leaves the index. `exclude` is **not** an access control — it keeps text out of the index, and a read of the entry still returns the field.

**Authorization is a plan, not a claim string.** The service compiles the key's `entries:read` claims — plus public collections, whose public-ness lives in the schema and which no claim-derived target can express — into a `SearchAccess` list of concrete targets. The engine applies it **before** rank, count and paging, so `total` and paging are correct rather than post-filtered. Adapters parse no claims.

**Routes** follow D19: the reach is in the path, never in a query parameter.

| Reach | Route |
|---|---|
| collection | `GET /api/projects/{p}/envs/{e}/collections/{name}/search` |
| scope | `GET /api/projects/{p}/envs/{e}/search` |
| instance | `GET /api/search` |

Each carries `q`, `filter`, `sort`, `limit`, `offset` and maps to `entries:read`. `GET` is the only method: `filter` is the same url-encoded JSON the list route already accepts, bounded by the same `MaxFilterNodes`/`MaxFilterDepth` caps (worst case 7,777 encoded bytes), so a request body buys nothing and would cost a duplicate surface, a second claim-wiring site, and a search that cannot be linked to. Both scoped routes register under `/envs/` and `/environments/`, and all of them register **before** the entry routes — Hono matches in registration order, so `/collections/{name}/search` would otherwise be captured as an entry whose id is `"search"`. A given `sort` wins and relevance is ignored; no `sort` with a non-empty `q` gives relevance order; neither gives `-$.updated_at`. `q` is optional, so at the collection reach a filter-only `/search` returns the same set as the list route in a different shape — a documented overlap, since the wider reaches need filter-only queries and a special rule at one reach would be arbitrary.

A hit discloses its location on the wrapper, never on the entry:

```json
{ "project": "acme", "env": "prod", "collection": "posts",
  "entry":    { "id": "01J8…", "rev": 2, "title": "Pricing" },
  "snippets": [ { "path": "$.data.body",
                  "before": "…our ", "match": "pricing", "after": " page…" } ] }
```

This is a deliberate exception to §5.1: a client cannot link to a result whose location it cannot see, and the access plan already bounds the disclosure to readable targets. No numeric relevance score is exposed, because two engines rank the same matches differently.

A snippet is **three strings, not one with markers in it** — the fragment is `before + match + after`. Marking the matched run up inline (`"…our [pricing] page…"`) reads well in a terminal and is ambiguous everywhere else: a body holding a bracket of its own, which any markdown link does, gives a highlighter two candidate pairs and no way to choose. Escaping would make every consumer learn an escape rule; offsets would make them agree on what a character is. Three strings need neither.

**Media stays out of the entry index.** It is instance-global with its own `media:*` claims (D23/D24), and folding it in would put two authorization models in one query. The admin UI merges the two result groups; the server does not.

**Engines report themselves.** Every search response carries `engine`, so a client can tell an indexed answer from a scanned one, and `silo search reindex` says plainly when there is no index to rebuild rather than reporting a silent success.

**Index state** (SQLite) is `entry_search_documents` — an explicit `docid INTEGER PRIMARY KEY`, never `entries.rowid`, because `VACUUM` renumbers the implicit rowid of a table whose primary key is composite — plus an external-content `entry_search_fts`. Triggers maintain it inside the transactions that already exist in `put`, `delete`, `deleteProject` and `deleteEnvironment`, and the update and delete triggers use FTS5's documented `'delete'` command reading `old.*`, since external content needs the *old* text to remove its terms. Versioning covers four inputs: engine, FTS schema and tokenizer configuration globally, extractor version and the per-collection `x-silo-search` hash locally. A global change rebuilds everything before the bind; a schema change rebuilds one collection. `silo search reindex [--check]` runs **two** integrity checks — FTS5's built-in one validates the index against the document table only, so content-versus-`entries` drift needs a second anti-join, in both directions (a document with no entry, and an entry with no document). `POST /api/search/reindex` is the same operation over HTTP and asks for the instance-wide read authority an export does: rebuilding reads every entry in the instance, so a narrow key must not become a way to make all of it searchable.

**Parity is by fixture, not by construction.** SQLite's Unicode tables and the JavaScript engine's are different, so the conformance contract is that the same fixtures match in both engines, that stable order is required only for an explicit field sort, and that relevance order and snippet text are engine-specific. Measured under `unicode61 remove_diacritics 2`: `foo_bar` splits on the underscore, a ULID stays one token, `https://silo.dev/a/b?x=1` splits into seven, `Café` folds to `cafe` — and `日本語のテキスト` is **one token**, because unicode61 does not segment CJK. Those deployments must select the `trigram` tokenizer; it is not a preference.

`format_version` does not change. The index is derived, lives only in SQLite, and never enters an export, so the frozen fs layout (D5) is untouched.

### 5.4 System collections

Collection names starting with `_` are reserved for silo. They flow through the same `Storage` interface and use the same envelope, but are hidden from collection listings, the UI sidebar, and exports (unless explicitly included). User schemas may not claim a `_` name. System collections exist once per instance.

Since D18, the same reservation applies one level up: project and env ids
starting with `_` are reserved for silo, exactly like collection names. In
practice this reservation is enforced by construction rather than an explicit
check — `Scope`'s id grammar requires a lowercase first character, so no
caller-supplied id can ever start with `_`. The one reserved scope,
`Scope.System` (`_system`/`_system`), is built through a private constructor
that bypasses that validation.

There are **eight** system collections, all living in `Scope.System`: **`_keys`** (§8); — since D23 — **`_media`** and **`_media_folders`** (§8.1); — since D38 — **`_audit`** (§8); — since D34 — **`_plugins`** (§13); — since D49 — **`_media_folder_moves`**, which holds a folder rename in flight and is empty in the ordinary case (§8.1); — since D51 — **`_scope_renames`**, which holds a rename's claim cascade in flight and is likewise empty in the ordinary case (§8); and — since D57 — **`_variables`**, one document per variable declaration (§5.6). Reusing the doc model here means adapters, the export engine, and the conformance suite cover system data with no extra code — the reserved scope is stored exactly like any other, with no special-cased path in any adapter. (D19 added `_projects`, to record scopes declared but not yet filled; D20 replaced it with first-class project/env storage and it no longer exists.)

Since D51 they are **named once**, in `SystemCollections`, and seeded into both adapters. That is not tidiness: `entries.collection_id` is a foreign key, so a system collection needs a `collections` row before anything can be written into it, and a list assembled by hand at each seeding site is a list that will disagree with itself. Their ids are the reserved names rather than minted ULIDs, so `_keys` addresses identically on every instance and an archive naming it needs no translation — which is also why the create paths refuse a supplied `_`-prefixed id, and why nothing has to scan the reserved scope for collisions. `SystemCollections.isKnown` is deliberately **not** the same question as `EntryUtils.isSystemCollection`: the latter asks whether a name is `_`-prefixed and reserves the whole namespace, and remains the security boundary; an unknown `_`-prefixed name is still reserved and still refused, it just has no row.

None of them has a *real* schema. Each row carries `{"x-silo-system": true}` — `x-silo-*` is reserved for silo (§5.2), which is the honest way to say the row exists for referential integrity — and nothing validates against it, because system writes reach `store.put` directly and never pass through `EntryService`. They still have to be reachable wherever content collections are enumerated (`Exporter`, and `Storage.ListEntryCollections` for the general case). `_keys` is a credential, so it stays behind `--with-keys`; `_media`, `_media_folders`, `_media_folder_moves` and — since D57 — `_variables` are ordinary data and are **always** exported, because an archive that carried media bytes but not their filenames and folders would restore a library with no organization in it — and, for the third, because an archive taken mid-rename holds the half-moved subtree either way, so carrying the marker is what lets the restored instance finish the move instead of keeping a split nothing has a record of. An empty project needs no collection of its own to survive a round trip: since D20 it exists as a stored project/env record, `listScopes()` reports it, and the archive carries it as a `projects/<p>/<e>/` directory — since D51 with its `.silo-project` and `.silo-env` markers, which is what carries the records' ids. A project holding **no environment at all** finally travels too: `listScopes()` answers pairs and could never name one, so `Exporter` now walks `listProjects()` as well.

### 5.6 Variables (D57)

A **variable** is a name declared once in a project, given a value in each
environment, and substituted into `{{NAME}}` wherever an entry references it.
It exists for the string that has to differ between `staging` and `prod` and is
otherwise identical everywhere — an API base URL, a support address, a CDN host
— which before D57 had to be written into every environment's entries and
hunted down in all of them when it changed.

**The name belongs to the project; the value belongs to the environment.** That
split is the whole feature, and it is what the storage shape is chosen for.
One `_variables` document per **declaration** holds
`{project_id, name, description, values}`, where `values` maps an
**`EnvironmentRecord` id** to that environment's value:

- **Keyed by record id, never by name**, so D51's renames move nothing.
  Renaming `prod` to `production` leaves every value exactly where it was; a
  name-keyed map could only manage that by joining the claim cascade.
- **Every environment's value in the declaration**, so resolving a scope is one
  filtered read and **no join**. The alternative — a document per (variable,
  environment) pair — also makes "declared but unset here" indistinguishable
  from "never declared", and that distinction is what the response depends on.

`values` holds **only the environments that have been given one**, and an
absent key is not `""`. An empty string is a value an operator chose and
substitutes as empty; an absent key means this environment has none, and the
reference is **left standing** in the response. So is a name nothing declares.
Blanking the text instead would silently delete content on the way out, and a
template that survives is one an operator can see and fix — the same
visible-beats-silent asymmetry `MediaRefs` takes about over-capture.

**Name grammar** is `^[A-Za-z_][A-Za-z0-9_]{0,63}$` — deliberately *not* the
scope/collection grammar, which is lowercase and allows `-`. Those ids become
path segments, claim segments and directory names; a variable name is none of
those, the convention every operator already has is `UPPER_SNAKE`, and allowing
`-` would make the template grammar ambiguous next to ordinary prose. Case is
preserved and significant. A **value** is a string and only a string, capped at
4,096 characters: substitution is textual, so `{{PORT}}` inside a sentence and
`{{PORT}}` as a whole field must not produce different types from one stored
value.

**`VariableTemplate` is the one parser** of `{{NAME}}`, shared by the server
that substitutes and the admin that previews, for the reason `ClaimGrammar` is
the one parser of a claim: a second would be a second answer to "what does this
text reference?", and the failure would be an editor showing a value the API
never fills in. Optional inner whitespace is trimmed; anything that is not a
well-formed name (`{{ }}`, `{{a b}}`, `{{9x}}`) is ordinary text; and a
substituted value is **never re-scanned**, so no value can expand into another
and no pair can loop.

**Resolution happens where media resolution already happens** —
`EntryUtils.toApiResponse`, after `MediaResolver`, through a synchronous
`VariableValues` built once per response, exactly as `MediaLinks` is. Running
after media is deliberate: a resolved URL is silo's own output, not content an
author typed. The walk is **not schema-driven**, unlike media's: a field is
media because the schema says so, but a template is a template because somebody
typed one, so gating substitution on a declared field kind would make the syntax
work in the fields people remembered to mark and silently not in the rest.
Object **keys** are never substituted, only values — a key is what a schema, a
filter path and a search index all address, and letting an environment rename
one would make the same entry a different shape per environment.

It costs **nothing when nothing is referenced**: `VariableRefs.extract` walks
the payload first, and a response holding no `{{` asks storage for no variables
at all — the early-out `MediaLinkResolver` takes for a payload naming no asset.
A response that *does* reference something pays one filtered read for the whole
page, however many references it holds. Both walks are depth-bounded, because an
untyped `{}` property accepts a document whose depth the caller chose.

**Transfer.** `_variables` is in every archive (§5.4), because one carrying
entries that say `{{API_URL}}` without the declaration behind it would restore
content whose references have all quietly stopped resolving. A round trip
preserves values because the archive carries each environment record's id
(D51). A **scope-to-scope copy** does not carry variables: it copies collections
and entries between two scopes that already exist, and the destination's
environment has its own id and its own values, which is the behaviour a copy
into a configured environment should have.

What §8 adds is the API surface and the claims, and §9 the two admin surfaces.
