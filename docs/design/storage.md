# Storage adapters

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 6. Storage adapters

### 6.1 Interface

```go
type Storage interface {
    // Projects, environments and collections — KEYED RECORDS since D51.
    //
    // Each has a ULID that never changes and a `name` that is a mutable label,
    // unique within its parent. Every listing addresses by name; every rename
    // addresses by **id**, because the id is the one thing a concurrent rename
    // cannot move under the caller's feet. Renames refuse a collision within
    // their container. The optional `id` on the create paths exists for import,
    // which carries ids in its markers and would otherwise remint every record
    // it restores; a supplied id that is malformed, reserved (`_`-prefixed) or
    // already taken is refused rather than silently replaced.
    CreateProject(ctx context.Context, name string, id ...string) (ProjectRecord, error)
    ListProjects(ctx context.Context) ([]ProjectRecord, error)
    FindProject(ctx context.Context, name string) (*ProjectRecord, error)
    RenameProject(ctx context.Context, id, name string) error
    DeleteProject(ctx context.Context, name string) error
    // ...and the same five for environments, taking (project, env).

    ListCollections(ctx context.Context, scope Scope) ([]CollectionRecord, error)
    FindCollection(ctx context.Context, scope Scope, collection string) (*CollectionRecord, error)
    RenameCollection(ctx context.Context, id, name string) error

    // Schemas. There is deliberately no CreateCollection: a collection's schema
    // is NOT NULL, so PutSchema is the only thing that brings a record into
    // being, and DeleteSchema is what ends it — it removes the whole collection
    // record, not a nullable field on a record that survives.
    PutSchema(ctx context.Context, scope Scope, collection string, schema json.RawMessage, id ...string) (CollectionRecord, error)
    GetSchema(ctx context.Context, scope Scope, collection string) (json.RawMessage, error)
    DeleteSchema(ctx context.Context, scope Scope, collection string) error // refuses while entries remain

    // Entries — Put is create-or-replace; caller sets envelope (scope included),
    // adapter assigns Seq. Get/Delete/List take scope explicitly.
    //
    // `usages` is the entry's COMPLETE set of media reference tokens (D23),
    // extracted by the caller with MediaRefs.Extract and replaced wholesale
    // in the same operation as the write. It is required, not optional: an
    // omitted set has no safe reading — "clear" orphans a live reference,
    // "leave" rots the index — so forgetting it must not compile.
    Put(ctx context.Context, e *Entry, usages []string) error
    Get(ctx context.Context, scope Scope, collection, id string) (*Entry, error)
    Delete(ctx context.Context, scope Scope, collection, id string) error
    List(ctx context.Context, scope Scope, collection string, q Query) ([]*Entry, int /*total*/, error)

    // Every non-system scope that EXISTS, sorted by (project, env). Since D51
    // that means "its record exists" — a child references its parent by id, so
    // content can no longer imply a parent that has no record, and emptying a
    // scope does not remove it.
    ListScopes(ctx context.Context) ([]Scope, error)

    // Media usages (D23). Derived state owned by the adapter: SQLite keeps a
    // media_references table written inside Put's existing transaction, the fs
    // adapter scans entry files and stores no index. Delete/DeleteProject/
    // DeleteEnvironment drop matching usages as part of the same operation.
    ListMediaUsages(ctx context.Context, mediaIDs []string, limit, offset int) ([]MediaUsage, int /*total*/, error)
    CountMediaUsages(ctx context.Context, mediaIDs []string) (map[string]int, error)

    // Every collection in this scope that still holds an entry, sorted by name.
    //
    // No longer load-bearing for addressing: since D51 every collection has a
    // record, so ListCollections is the authority on what exists and this cannot
    // report one that does not. It stays because "which of these hold content"
    // is a question the export engine and the scope-delete guard both ask, and
    // answering it from records alone would mean counting every collection's
    // entries to find out.
    ListEntryCollections(ctx context.Context, scope Scope) ([]string, error)

    // How many entries each collection in this scope holds, keyed by collection
    // name; a collection with none is absent rather than zero (D54).
    //
    // One question, one answer. What every caller reached for instead was a
    // limit=1 list per collection, which reads an entry off disk to learn a
    // number and costs a round trip per collection over HTTP — measured at four
    // megabytes to draw a sidebar over forty collections of tabular content.
    CountEntries(ctx context.Context, scope Scope) (map[string]int, error)

    // Instance metadata (instance_id, last_seq, defaults_initialized). seq stays
    // instance-global and monotonic across every scope. The flag is durable
    // rather than derived, so a renamed or deleted default project is not
    // resurrected at the next start (D51).
    Meta(ctx context.Context) (Meta, error)
    MarkDefaultsInitialized(ctx context.Context) error

    Close() error
}
```

Seq assignment lives in the adapter because it must be atomic with the write. A future `Changes(sinceSeq)` method will be introduced as an *optional* interface (`interface{ Changes(...) }` upgrade check) so v1 adapters don't have to implement it.

Adapters assume **one process owns a data directory**, which is enforced above
them at the process boundary rather than by any of them (D25): `Storage` has no
cross-process lock, the fs adapter holds `last_seq` in memory, and `Service`'s
write mutex is process-local. `RunFile.assertNotRunning` is what makes that
assumption true, and since D82 it decides by identity rather than by pid alone
— a record naming this process, or written in another boot, or unrefreshed for
two minutes, is a dead server's — because the 2026-09-18 audit showed the pid
check refusing every restart of a crashed Docker instance, where the server is
pid 1 each time and so always found "itself" alive. A database is not a
directory, so the Postgres adapter adds the same guarantee where its data
lives: an owner lock per schema (§6.6), because two servers with two data
directories can point at one database and `RunFile` would pass both.

Rules for all adapters: single-writer semantics per entry, atomic writes (no torn entries observable), `List` results stable-ordered (sort keys, then `id`), the **record existence rule of D51** — a project, environment or collection exists exactly when its record does, superseding D20's "created explicitly *or* still holding content"; a scope reported by one adapter and not the other is a portability bug, since `Exporter` enumerates `listScopes()` — and **`project`/`env`/`collection`/`id` validated as safe path segments** (`EntryUtils.assertSafeSegment`: non-empty, not `.`/`..`, no `/`, `\`, or NUL, ≤255 bytes) on every entry call. That last rule is a port contract rather than one adapter's local defense: the fs adapter turns these values into a path, so an unvalidated `id` from an import archive could otherwise plant an entry outside its scope or outside the data dir entirely — and a cap the fs adapter can't honor would let SQLite accept what fs rejects mid-write with `ENAMETOOLONG`. Both adapters therefore reject the same values, and the conformance suite pins that. Since D18, `$ref`/`$defs` resolution, the compiled-validator cache, and referrer checks (§9) are likewise scoped — the same collection name in two scopes never shares a validator or resolves a ref against the other's schemas.

**One answer per query, whichever adapter asks (D92).** Until a third adapter was coming, "the contract" was whatever SQLite and the fs adapter happened to agree on, and they disagreed in places no test looked: SQLite's `json_extract` returns SQL values, so `eq true` matched a `1`, a string compared greater than every number, an object compared as its JSON text, and `in [null]` matched nothing because `IN` is `=`; the fs evaluator did none of that. They also sorted strings differently (`BINARY` against `localeCompare`) and disagreed on `created_at` after an overwrite. Postgres could have matched either and neither would have been *the* answer, so the contract now states one, and `QueryTypesSuite` pins it — the code before this change fails it eight times, once per disagreement.

- **Types are strict.** `eq`, `neq` and `in` match a node only of the value's own JSON type: null, boolean, number or string. `gt`/`gte`/`lt`/`lte` compare a number only with a number and a string only with a string, and any other pairing matches nothing. This is `FsFilter`'s rule, and it is also what jsonb compares natively. The SQLite compiler holds it with a `json_type` guard on every leaf, and tests `null`, `true` and `false` by type alone, because `bun:sqlite` binds a boolean as `0` or `1`.
- **Strings are in codepoint order**, for comparisons, sorts and every sorted listing (projects, environments, scopes, collections, media usages). That is SQLite's `BINARY` over UTF-8 and Postgres's `COLLATE "C"`. It is neither JavaScript's `<`, which compares UTF-16 code units and so puts U+1F600 before U+FFFD, nor `localeCompare`, which depends on the runtime's locale; `CodepointOrder` is the one in-memory implementation.
- **A sort ranks types before values**: missing and JSON null, then numbers, strings, booleans (`false` first), arrays and objects. Arrays and objects tie within their type, so the next key decides. `EntryNodes.compare` answered `0` for every mixed pair, which is not a transitive order and leaves `Array.prototype.sort` free to return anything; SQLite put booleans among the numbers and objects among the strings. The compiler sorts on a `CASE json_type(…)` rank first, then on the value, with containers mapped to `NULL`. Missing still sorts first ascending and last descending, as both adapters already did.
- **An entry is created once.** An overwrite keeps the stored `created_at` and takes the caller's `updated_at`, which is what SQLite's upsert always did.
- **Entry data must be portable.** A NUL character or an unpaired surrogate, in any key or value, is refused (`PortableData`), and `assertSafeSegment` refuses an unpaired surrogate too. Postgres's jsonb stores neither, and a rule one adapter enforced alone would be a divergence of exactly this kind. It is checked twice: in `SchemaValidator.validateEntry`, so an API write answers `400` and an import counts a rejection rather than aborting, and in every adapter's `put`, since system writes never reach the validator.
- **`close()` may be called twice.** `keys`, `export` and `import` close the store they were handed, and the runtime closes it again on the way out.

**Native search is a capability the store offers, not a class the runtime knows (D92).** `IndexedStorage` — `createSearcher()`, `needsSearchRebuild()`, `searchRebuilt()` — is what a store implements when it keeps a search index inside its own writes (D30), and the runtime finds it by asking the store rather than with `instanceof SqliteStore`. It is not on `Storage` itself because the provider scaffold stubs every port method as an `async` function that throws, and these three are called at startup; left off the port, a scaffolded provider is searched by `ScanSearcher` until it chooses otherwise. `Searcher.check()` is async, since an index in another process can only be checked with a query.

### 6.2 SQLite adapter

```sql
-- Since D51: three keyed record tables, and every reference by id. A rename is
-- one UPDATE of a `name` column and touches nothing below it.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
              -- instance_id, last_seq, format_version, defaults_initialized
CREATE TABLE projects (
    id         TEXT PRIMARY KEY,         -- ULID; `_system` for the reserved one
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE environments (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, name),
    UNIQUE (project_id, id)              -- so children can reference the pair
);
CREATE TABLE collections (               -- replaced `schemas`; one row per collection
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    env_id     TEXT NOT NULL,
    name       TEXT NOT NULL,
    schema     TEXT NOT NULL,            -- NEVER null: a collection always has one
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id, env_id) REFERENCES environments(project_id, id),
    UNIQUE (env_id, name),
    UNIQUE (project_id, env_id, id)
);
CREATE TABLE entries (
    id            TEXT NOT NULL,
    project_id    TEXT NOT NULL,         -- denormalised, so a scope query needs no join
    env_id        TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    rev           INTEGER NOT NULL,
    seq           INTEGER NOT NULL UNIQUE,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    data          TEXT NOT NULL,         -- JSON
    PRIMARY KEY (collection_id, id),
    FOREIGN KEY (project_id, env_id, collection_id)
        REFERENCES collections(project_id, env_id, id)
);
CREATE INDEX idx_entries_seq ON entries(seq);
CREATE TABLE media_references (          -- D23; derived, rebuilt by `silo media reconcile`
    media_id      TEXT NOT NULL,         -- asset ULID, or "blob:<key>" for a pre-D23 reference
    project_id    TEXT NOT NULL,
    env_id        TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    entry_id      TEXT NOT NULL,
    PRIMARY KEY (media_id, collection_id, entry_id),
    FOREIGN KEY (collection_id, entry_id)
        REFERENCES entries(collection_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_media_refs_entry ON media_references(collection_id, entry_id);
CREATE TABLE entry_search_documents (   -- D30; derived, rebuilt by `silo search reindex`
    docid         INTEGER PRIMARY KEY,  -- explicit: VACUUM renumbers an implicit rowid
    project_id    TEXT NOT NULL,
    env_id        TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    entry_id      TEXT NOT NULL,
    label         TEXT NOT NULL,        -- weighted text (x-silo-search.label)
    body          TEXT NOT NULL,
    UNIQUE (collection_id, entry_id),
    FOREIGN KEY (collection_id, entry_id)
        REFERENCES entries(collection_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_entry_search_scope ON entry_search_documents(env_id, collection_id);
CREATE VIRTUAL TABLE entry_search_fts USING fts5(  -- external content; 3 sync triggers
    label, body, content = 'entry_search_documents', content_rowid = 'docid',
    tokenize = '<[search] tokenizer>'
);
```

`media_references` and `entry_search_documents` rows are written inside `put`'s existing transaction — the
one that already allocates `seq` — so an entry, its references and its index row land together
or not at all. Since D51 they are **removed** by the `ON DELETE CASCADE` above
rather than by explicit purges: the bulk deletes remove entries before their
derived rows, an order a non-cascading child key would reject, and the cascade
fires `entry_search_documents`' own `AFTER DELETE` trigger so FTS5 stays in step
(verified — SQLite fires triggers for cascaded deletes even with
`recursive_triggers` off).

**The relationships are composite on purpose.** Independent single-column keys
would happily accept a `project_id` from one branch beside an `env_id` from
another, so each child references its parent as a tuple and each parent carries
the extra `UNIQUE` a tuple reference needs as its target.
`PRAGMA foreign_keys = ON` is set in `applyPragmas` — without it every key here
would be documentation — and runs outside any transaction, because that pragma
is a silent no-op inside one. `PRAGMA foreign_key_check` runs after open. DDL,
the `meta` rows and the reserved `_system` records are **one transaction**: a
database with the tables but not the system records is one where the first key
write fails a foreign key, and one with the records but no format stamp is one
the next start refuses.

**Names meet ids in exactly one place**, `SqliteScopeResolver`, and only
forwards. The reverse direction is needed by just the few queries that span
scopes — media usages, search hits, `listEntryCollections` — and those join the
record tables in SQL, which keeps the ordering and the page boundary on the
names rather than on the ids underneath them. Single-scope reads never need it,
since the caller passed the names in. The cache is flat and dropped whole on any
record write: creates, renames and deletes are rare next to reads, so a precise
invalidation would be more code for a saving nothing measures.

The search tables exist only when `[search] enabled` is true **and** the SQLite build has FTS5, which is probed at open rather than assumed. `docid` is an explicit `INTEGER PRIMARY KEY` because `VACUUM` renumbers the implicit rowid of a table whose primary key is composite, which would silently point the index at the wrong rows; the upsert uses `ON CONFLICT DO UPDATE` so it survives a rewrite. Opening with search **disabled** clears the version stamp but drops nothing — every CLI subcommand opens the store, so a `silo keys list` from a build without FTS5 would otherwise delete the index a running server is maintaining on the same data dir, and a cleared stamp already forces the rebuild that correctness needs.

WAL mode, `busy_timeout` set, one write connection + a read pool. `seq` allocated by incrementing `meta.last_seq` inside the write transaction, still instance-global rather than per-scope. Filters compile to `json_extract(data, '$.path')` expressions, each guarded by `json_type` so a comparison stays within one JSON type (§6.1, D92); no per-field indexes in v1 (roadmap: expression indexes for declared hot fields). Scope values (`project`, `env`) always reach SQL as bound parameters, never interpolated, same as every other query value. `SqliteStore.open` refuses to open a data dir stamped with a different `format_version` before running DDL — `CREATE TABLE IF NOT EXISTS` would otherwise silently leave an older entries table without these columns in place, so queries would crash on "no such column" instead of failing with an actionable message. The `meta.format_version` row is checked first, but isn't trusted alone: an older db could in principle have old-shaped tables without a `format_version` row to contradict, so the guard also inspects the shape directly. Since D51 that means two things: a `schemas` table existing **at all** is proof of a pre-D51 directory, since nothing creates it any more; and `entries` is inspected via `PRAGMA table_info` for a `collection_id` column. `format_version` is `"1"` at 1.0, and there is **no migration** for a directory stamped otherwise: the guard refuses it rather than reading it.

No part of the adapter holds the `Database` directly; they all hold a `SqliteConnection`, which owns it together with every statement prepared against it. The reason is that bun:sqlite finalizes a statement only if it is still in `Database.query`'s own cache when the database closes, and that cache holds exactly **twenty** — the twenty-first distinct statement evicts the first, and an evicted statement is never finalized. `Database.prepare` is not cached at all and is never finalized. Either way the unfinalized statement keeps the database file open, so `close()` stops *using* the file without *releasing* it: `sqlite3_close_v2` leaves a zombie connection behind. On Windows that is not a detail, because an open handle makes the data directory undeletable and unmovable, so the leak surfaces as `EBUSY` from whatever next tries to remove or move the directory rather than as anything recognisably about SQLite. `SqliteConnection.query` therefore caches without a bound and `close()` finalizes the lot. SQL whose text is built per call — a compiled filter, an `IN` list sized to its arguments — must not be cached at all, or the map would grow by one live statement per shape; that goes through `SqliteConnection.once`, which prepares, runs and finalizes in a `finally`. The interpolation that remains in a cached `query` is a class constant or the two-value table name in `touchName`, so what is cached is bounded by the code rather than by the workload.

**The scans run on a second connection, on their own thread** (D81). The
"read pool" the paragraph above promised did not exist until the 2026-09-18
audit measured what its absence cost: `bun:sqlite` is synchronous, a filter or
a sort over `data` is a scan of the collection (there are no per-field
indexes), and the scan held the one JS thread — 0.6 s for one `contains` over
200,000 rows, 12 s for a 49-way `or` of them — while every other request,
`/api/health` included, waited. Any public collection made that anonymous.
`SqliteReadWorker` is a store's handle on `SqliteReadThread`, one `Worker`
per process holding one connection per database path, which WAL lets read
while the main connection writes; `SqliteEntryStore.list` and
`SqliteSearcher.search` post their two statements to it and await the rows, so
the main thread is free for the duration. One thread rather than one per store
because a `Worker` is not cheap to come and go: the first cut spawned one per
store, the test suite opens hundreds, and a single run spawned 539 workers,
took the runtime to 11 GB and crashed it — terminated workers are not fully
released. The server opens one store, so for it the two designs are the same.
The thread's source is a string shipped as a `data:` URL, for the reason the
plugin host's is: a compiled binary cannot load a worker module from outside
its bundle. `PRAGMA query_only` on every connection means a bug there cannot
become a second writer (D25). The thread starts on the first read, restarts on
the read after a failure, is held (`ref`) while a read or its own start is
pending and let go (`unref`) when nothing waits on it — so an idle thread never
holds a CLI command open, and a pending read never lets the process end. The
second half was learned the hard way: shipped permanently unref'd, the first
threaded read of `silo keys list` or of `serve`'s bootstrap was the only thing
on the loop, because `main.ts` fires `Cli.run()` without awaiting it and
`bun:sqlite` itself holds nothing open, so the loop drained and the process
exited 0 with nothing printed and no server listening. `bun test` never saw it,
because the runner's `NODE_ENV=test` turns the thread off; the liveness test
spawns a child without that variable for exactly this reason — and a store's
`close` asks it to close that file's handle and waits for
the answer — a fire-and-forget close or a `terminate` returns first, and on
Windows the directory is then still undeletable, the same `EBUSY` the
statement cache exists to prevent. Reads queue up to `MaxPending` (64) and the next is refused
as `503 busy` with `Retry-After: 1`: a flood of slow scans degrades listing and
search, and nothing else. An in-memory database gets no worker and reads on
the main connection as before, and so does every store opened under `bun test`
unless it asks (`SqliteStore.readThreadDefault`, `SILO_READ_THREAD=on|off` to
force either): the runner's `expect(...).rejects` wait does not deliver a
worker's replies once it has answered twice, which one shared thread always
has by the second test, so the suite runs the same SQL on the main connection
and the thread's own test turns it on. The server never runs under the runner. Two things bound what one caller can cost:
`MaxFilterLeaves` (16) caps the field tests a filter may name, since each is
evaluated per row, and the queue cap sheds what the worker cannot take on.
Writes, counts, gets and the media catalog stay on the main connection; they
are indexed reads or the one writer, and moving them would buy nothing.

### 6.3 Filesystem adapter (layout = export format, per D5)

Every collection lives under its `(project, env)` pair, and the directories are
still named by **name** rather than by record id (D51): this layout *is* the
export format, and it is meant to be read and diffed by a human. The ids live in
the markers instead, which is what makes a rename an `fs.rename` of a directory
with the identity travelling inside it.

```
<data-dir>/
  manifest.json                     # format_version, instance_id, last_seq,
                                    #   defaults_initialized
  projects/
    <project>/
      .silo-project                 # {id, created_at} — REQUIRED since D51
      <env>/
        .silo-env                   # {id, created_at}
        schemas/
          posts.schema.json         # the JSON Schema document, pretty-printed
          .posts.silo-collection    # {id, created_at, moving_from?}
        content/
          posts/
            01J8XQ4Z8K9M2P3R5T7V9X1B3D.json
    _system/
      _system/
        schemas/
          _keys.schema.json        # {"x-silo-system": true} — bookkeeping, never validated
          ._keys.silo-collection   # id is the reserved name, on every instance
        content/
          _keys/                   # system collections live in the reserved scope
            01J8XQ50P1R2S3T4U5V6W7X8Y9.json
```

The reserved system scope (`_system/_system`) is just another `<project>/<env>` pair — the adapter has no branch for it. `listScopes()` walks the `projects/*/*` directory pairs, skips any whose names start with `_`, and reports a pair only if it carries a marker. **Existence is the record, not the content** (D51): a marker is where the ULID lives, so it is required, and a directory without one is not a scope — which also means a directory left behind by a delete is not one either, as before, but now for a reason that has an answer to "what is this scope's id".

The seven system collections are seeded here by `FsSystemSeed`, the counterpart of `SqliteMigrations.seedSystemRecords`, so both adapters answer `listCollections(Scope.System)` the same way. Seeding one and not the other would have left the fs adapter reporting no record for a collection it happily holds entries for, which is exactly the divergence the conformance suite exists to catch.

**There is deliberately no name-to-id cache on this adapter**, where SQLite has one: identity is read from the markers on every operation. That is the same argument D23 makes for keeping no usage index here — this adapter exists for `rsync` and `git checkout`, and an in-memory index goes stale the moment someone checks out a branch under a running process. It is already O(n)-per-query by design, so a rename addressed by id scans for it.

A project or environment rename is a single `fs.rename` of the directory, atomic on one filesystem, with the marker travelling untouched. **A collection rename is the one that is not**: the marker, the schema file and the content directory are three moves. So the destination marker carries `moving_from`, written before the first move and cleared after the last, and `FsCollectionStore.resumePending` finishes it at the next open, counting failures rather than throwing — the same reasoning D23's and D49's resumes give. Recovery is *decidable* precisely because the id is in both places: a destination marker holding **this** id is this rename half-done and is resumed, while any other id is a genuine collision. The content move has one more rule, learned from a data-loss bug found in the 2026-09-18 audit: `fs.rename` of a directory is one syscall and never leaves both ends behind, so a destination directory that *already exists* is never "this move, already landed" — it is a leftover (an empty directory a delete failed to remove, a stray temp file), which is removed so the rename can land, or it holds entry files, which is a collision and is refused. The source is never the thing discarded, because the source is the collection. Two guards keep the leftover from arising at all: `delete` refuses while entry files remain, as SQLite does, and then removes the directory whole; and `rename` refuses a destination name whose content directory holds entries even when no marker claims it, since an import can leave content with no record. `putSchema` writes the schema **before** the marker for a related reason — a crash between the two then leaves a schema file no listing reports, which the next put adopts, where the other order would leave a collection that lists and has no schema, the one state the `NOT NULL` invariant exists to rule out.

Each entry file is the full envelope, pretty-printed with a fixed field order — every write serializes the same envelope shape in the same order, so diffs stay minimal (git-diff-friendly), though it's insertion order, not alphabetical. The `project`/`env`/`collection` fields carry the scope and collection name but are **not** trusted on read: `get`/`list` always take `project`/`env` from the scope that was queried (the directory the file was found under), and import takes both from the archive path — the path is the addressing authority, not the file's own contents. This also closes a concrete bug class: an envelope that disagreed with its path could otherwise make a later write fork the entry into the wrong scope.

```json
{
  "id": "01J8XQ4Z8K9M2P3R5T7V9X1B3D",
  "project": "acme",
  "env": "prod",
  "collection": "posts",
  "rev": 3,
  "seq": 142,
  "created_at": "2026-07-03T14:00:00.000Z",
  "updated_at": "2026-07-03T15:30:00.000Z",
  "data": { "title": "Hello" }
}
```

Writes are `O_TMPFILE`-style: write to `.<id>.json.tmp`, fsync, rename. `manifest.json` is rewritten (same tmp+rename) after each write to persist `last_seq`; on startup the adapter verifies `last_seq >= max(seq)` found on disk (now recursing through the whole `projects/` tree) and repairs the manifest if the process died between the two writes. Listing = read directory (names are ULIDs, so lexical order = creation order), filter in memory. This is O(n) per query — acceptable and documented; the fs adapter's job is workflow (git, rsync), not throughput.

**Frozen-format consequence (accepted in D5):** no sharded directories, no on-disk indexes, no binary formats — ever — without a `format_version` bump and migration tooling. From 1.0 that bump is a major release rather than a cheap one: D18 broke the layout outright (flat → `projects/<p>/<e>/...`) with no migration path, and the whole point of freezing the format is that it does not happen again on those terms. `FsStore.open` refuses a data dir stamped with a different `format_version` rather than misreading it as the new tree.

### 6.4 Blob storage, and changing it from the admin (D16, D45)

Media bytes go through `BlobStorage`, a six-method port with two shipped
adapters — `FsBlobStorage` (a directory) and `S3BlobStorage` (S3 and anything
speaking its API, built on Bun's own `S3Client`) — resolved by driver name
through `ProviderRegistry` exactly as the `Storage` adapters are, so a provider
plugin's driver reaches the same lookup the built-ins do (§13.7).

`put` **overwrites atomically**, and since D67 that matters. `FsBlobStorage`
writes a temp sibling and renames over the key rather than truncating it in
place; `S3BlobStorage` never had the problem, since a `PUT` publishes no
partial object. A plain `writeFile` was harmless while every key was written
exactly once — a crash mid-write left bytes nothing pointed at yet — but
replacing an asset's content makes an overwrite ordinary, and there the same
crash leaves a *catalogued* asset truncated with its record still describing
what used to be there. `reconcile` would not catch it: it asks whether a blob
exists, not whether it is the one the record describes. The temp name is
deliberately not derived from the key, so a leftover from a hard crash is
reported as an orphan rather than adopted as an asset by the pre-D23
`<sha256>_<name>` rule. The port is still six methods; nothing about this is
visible through it.

Which one an instance uses was, until D45, a `silo.toml` question and only that:
`[blob_storage]`, the `SILO_BLOB_*` variables, or `--blob-path`. That is fine on
a box with a shell and impossible on a managed platform without one, where
pointing silo at a bucket meant redeploying the process. `GET`/`PUT
/api/media/storage` and the admin's **Settings → Media Library** page close it,
and the design is mostly about *not* introducing a second source of truth.

**A save writes the file, and the file still decides.** `BlobStorageTable`
replaces the `[blob_storage]` table as text — the sibling of `PluginBlockWriter`,
with the same two rules: everything outside the table survives, and the result is
parsed before it is written, with the write abandoned unless the rest of the
document reads back identical and the table reads back as what was rendered.
What it cannot preserve is comments *inside* the table it replaces, which is the
honest cost of editing a table through an API instead of by hand.

**What takes effect is what the next start would compute.** After the write the
config is re-read through the same `reload` closure `PluginSupervisor` holds —
flags and environment back on top — and the store is opened from *that*, never
from the posted body. A bucket supplied by `SILO_BLOB_S3_BUCKET` outranks the
file at the next start, so an instance running on the posted value in between
would be reporting a configuration nothing else agrees with. D42/D43's rule
carries over unchanged:

> **The file must never describe a state the next `serve` cannot reach.**

So the driver is checked against the registry *before* anything is written (a
typo is the likely mistake and should cost nothing), and a configuration that
cannot be opened — `s3` with no bucket, which `ProviderRegistry.openBlob`
remains the only thing that refuses — restores the previous file byte for byte
and answers 400.

**The swap is one assignment.** `ServiceContext.blobStorage` became a cell behind
a getter, which is `PluginAuthority`'s shape and works for the same reason: every
media call site already read it at the moment it acted, so a request already
inside `get` finishes against the store it started on and the next one does not.
The replaced store is closed afterwards, forgivingly.

**No bytes are moved.** An instance repointed from a directory to a bucket keeps
a catalog full of assets the new store has never heard of. That is a property of
object stores rather than something a swap could paper over, so the admin says it
beside the provider selector and `silo media reconcile` is what reports the
damage afterwards.

**Two configurations, not one.** The API reports `file` and `in_force`
separately, with `overrides` naming each field the file does not decide. Without
that split the page would lie twice: the fs media path is `<data dir>/media`
*precisely while nobody has named one* (§10), so seeding a form from what is in
force and saving it back would pin media in place and break `--data`; and an
operator would type a bucket that an environment variable was quietly beating.
An env var is reported whenever it is **set**, even when it agrees with the file,
because the next edit to that field will still do nothing.

**The secret is write-only.** The read carries `secret_access_key_set` and never
a value. An omitted secret keeps the file's and `""` clears it — the two states a
field nobody can read back needs — and the merge base is the **file** rather than
the config in force, so a credential held in the environment is never copied into
a file that is usually in version control.

**Authority.** `media:configure` guards both verbs. It is one claim rather than
the read/write pair `keys:*` and `plugins:*` have, because the read is not the
harmless half here: it names the bucket, the endpoint and the access key id an
instance authenticates with. It is carried by no preset but `root`, and it is on
`PluginForbiddenClaims` — a plugin holding it would receive every future upload
in the instance, including uploads made by keys that hold no media claim at all, and
it would get there by writing the one file that decides what code runs. Changes
are appended to the trail as `media.configure` (D38), carrying the driver and the
bucket or path but never the secret.

### 6.5 Where media URLs point, and what the library accepts (D46)

`[blob_storage]` decides where the bytes go. Two further questions are not about
the driver at all — what URL a client is handed for them, and what may be put in
the library in the first place — so they are a second table, `[media]`, behind a
second route (`GET`/`PUT /api/media/settings`, §8.3) with its own Save on the
same page. An fs instance behind a CDN wants a base URL exactly as much as a
bucket does, which is the test that says these are not driver settings.

**The store decides the shape of a media URL where `base_url` does not** (D60).
There is no setting for the shape a store chooses, and there used to be (D58):
`base_url_target` named whether `base_url` fronted silo or the bucket, which was
a second answer to a question `[blob_storage]` had already settled, and the two
could disagree — an instance moved to a bucket kept answering `server`, so the
media library listed a relative `/media/<id>` for the same asset the collections
API answered a bucket URL for.

`BlobStorage` answers it instead, through an optional **`publicRoot()`**: the
URL root a blob key is appended to, or `null` where the store has no public face.
It is on the port because only the store knows how its own objects are addressed
— `force_path_style` alone moves the bucket between the host and the path, and a
driver a provider plugin contributed is not describable from outside it at all.
`S3PublicUrl` derives it from the same options the client is built from, so the
addressing silo hands out and the addressing silo writes to cannot drift.

**A configured bucket is a bucket meant to serve** (D59). Moving a media library
off local disk and onto object storage *is* the decision to let the store
deliver, so `publicRoot()` answers the derived root by default and no second
question is asked about it. `[media] base_url` still swaps the host, and nothing
else has to be set for an S3-backed instance to hand out S3 URLs.

**Where silo does serve the bytes, it serves them as it reads them** (D80).
`BlobStorage.get` reads an object whole, and `/media/<id>` handed that buffer to
the response after copying it once more, so every in-flight download cost
twice the asset — and the largest asset was one anonymous `?sort=-size` away.
The port gains an optional **`stream(key, range?)`**: a body forwarded as it
arrives, plus the size where the store knows it without a second round trip.
`FsBlobStorage` answers with `FileByteStream`, a pull-based reader over a file
handle in 64 KB chunks, because the runtime's own file bodies were measured on
Bun 1.3.14 and each failed in its own way — a `Response` over a file handle read
the file whole per request, the handle's `.stream()` grew the process by
hundreds of megabytes under six concurrent downloads, and a sliced handle's
stream returned nearly the whole file for a 1,000-byte range; the hand-written
one grew the process by 24 MB for the same six downloads and slices exactly.
It opens the file on the first read, not when it is built — its high-water mark
is zero — because a body nobody reads, such as the GET body Hono drops
uncancelled to answer a `HEAD`, would otherwise hold a handle until the
collector closed it, which Bun 1.4 raises as an error.
`S3BlobStorage` answers with the object handle's stream, a slice of which is a
ranged `GetObject`, and leaves `size` unknown on purpose: learning it costs a
HEAD that a policy granting `s3:GetObject` alone refuses, and the catalog has
it. `MediaDelivery.open` resolves the request's range against the catalog's
size, so a bucket is never asked a second question per read. The method is
optional so a provider plugin written against the earlier port keeps working;
the caller then falls back to `get` and slices the bytes it was handed. The
runtime drops a `Content-Length` set on a stream body, so a whole answer is
chunked and a ranged one carries the size in `Content-Range`, which is the
header a seeking client reads anyway.

**And it serves them as data, never as a page on its own origin** (D83). The
API and the admin share one origin, and the admin keeps an API key for every
configured server in that origin's `localStorage`, so an uploaded document a
browser would render — an SVG with a `<script>`, an HTML file an operator's
allowlist let through — was a way to read every one of those keys; the
2026-09-18 audit (H1) walked it from a `write`-preset upload to root. Every
`/media/<id>` answer now carries `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: sandbox` (`ResponseSandbox`), so whatever does render
gets an opaque origin and no script; images, video, audio and PDF stay
`inline` and everything else, an SVG first among them, is a
`Content-Disposition: attachment` (`MediaDisposition`), which a subresource
load ignores — an `<img>` still draws it — and a navigation obeys. The
`content_type` recorded at upload is read off the filename's extension and
never off the type the client declared, since the extension is what the
allowlist already judged. Measured on a Chromium browser before choosing: a PDF
renders under `sandbox`, an iframe `sandbox` *attribute* blanks the PDF viewer
(so the admin's preview leans on the header, not the attribute), and a
navigated SVG's script does not run.

**`[blob_storage] public_read` is the way out, not the way in.** It exists
because readability is the one thing here that is genuinely not derivable: it
lives in a bucket policy, and silo's credentials say what silo may write rather
than what the public may read. An operator whose bucket is deliberately private
sets it `false` and gets `/media/<id>` with silo streaming the bytes, instead of
being stuck with links that 403. Silo cannot detect that case, so it has to be
told — but being told is the exception, and the default follows the configuration
that was already made.

Turning the key on grants nothing. A bucket needs a policy allowing anonymous
`s3:GetObject`; one with only Block Public Access switched off still refuses
every read, and the symptom is `AccessDenied` on a URL silo formed correctly.

This is not `base_url_target` returning. That key restated where the bytes live,
which `[blob_storage]` already said, so the two could disagree. `public_read`
states something nothing else in silo knows, and it changes no address: it
decides only whether the derived root is used or silo serves the bytes itself.

`MediaLinks` then has one rule, and **`base_url` alone decides which branch of
it applies** (D60):

- **`base_url` is set** — `<base_url>/media/<id>`, whatever the store is. The
  base is set in order to name *this instance*, so it takes this instance's own
  route, and whatever domain and path it carries is kept with `/media/<id>`
  appended. D58 had the store keep choosing the path here, which on a bucket
  produced `<base_url>/<blob key>`: a well-formed URL for a path silo has no
  route for.
- **It is not, and the store has a public root** (a bucket) — `<that
  root>/<blob key>`. The bucket serves the bytes and silo is not consulted,
  which is the only shape that works for a reader that cannot authenticate and
  will not follow silo's cache headers: an email client, above all. It costs a
  catalog lookup, because a blob key lives on the record rather than in the
  reference — done **once per response, before the entries are mapped**
  (`MediaLinkResolver`), never inside the mapping.
- **Neither** — `<request origin>/media/<id>`. silo streams the bytes and the
  asset is addressed by **catalog id**, so the URL survives a rename and is
  derivable from the reference alone. That derivability is what keeps
  `EntryUtils.toApiResponse` a pure synchronous function, which is what makes
  resolving a page of entries free.

The base must be absolute http(s). A *relative* one would resolve against
whatever origin the reader happened to have, which is what leaving it empty
already does, and only one of the two says so; a path is fine and is kept.

Unset, a media field resolves against the bucket, or against the origin the
request arrived on — the only origin known to be reachable by whoever asked, and
the reason D35 returns `""` for a plugin-dispatched request rather than
inventing one. A bucket-backed asset whose blob key was **not** resolved, past
`MediaLinkResolver`'s lookup cap, takes silo's route on that same origin: the
one host known to answer it. D35's judgement again.

The cost of pinning the base to silo's route is that a CDN in front of the
*bucket* can no longer be named here. One in front of *silo* can, and is the
case operators actually have; a CDN over a bucket that rewrites nothing can be
pointed at the bucket's own root instead.

Nothing here reaches backwards: changing the base does not rewrite a URL already
sitting in a sent email.

**`extensions` is an allowlist, and it is checked on the extension.** Not on the
declared content type, because a multipart part carries whatever `Content-Type`
the client chose to put in it, and trusting that lets the caller decide whether
the caller is allowed; the extension at least decides what the file is served
back as, since `MimeUtils.lookup` reads exactly that. Only the **last**
extension counts, so `invoice.pdf.exe` is an `.exe`. The check runs before any
bytes are written, so a refused upload leaves nothing for `reconcile` to find,
and it runs on **rename** as well — `PATCH /api/media/{id}` is the other way a
filename enters the library, and without it `report.png` becomes `report.exe`
after the fact and the check is decoration. An empty list is refused at parse:
a library that accepts nothing is a mistake rather than a policy, and `["*"]` is
how "accept everything" is said out loud. The default is media types only —
images, video, audio and PDF — and since D83 without `svg`: an SVG is a
document that can run script, and the 2026-09-18 audit (H1) showed one uploaded
with a `write`-preset key running on the admin's origin with every saved key in
reach. `/media/{id}` now serves every asset with `nosniff` and a
`Content-Security-Policy: sandbox`, sends an SVG and anything not image, video,
audio or PDF as an `attachment` (`MediaDisposition`), and reads `content_type`
off the extension rather than off what the upload declared — so an operator
who trusts every uploader can add `svg` back, and the file says so.

**What does not change is D23.** Blob keys stay flat and folders stay catalog
metadata even in `store` mode, where the key is the public path. Mirroring
folders into the bucket was considered and refused: S3 has no rename, so a move
would become a copy-and-delete of the bytes and would break every URL already
published for that file — the two costs D23 was written to avoid, in exchange
for a bucket listing that reads more tidily in a console.

### 6.6 Postgres adapter (D93)

`PgStore` (`adapters/storage/postgres/`) keeps silo's tables in one schema of
one database — `silo` by default, any name matching `[a-z_][a-z0-9_]{0,62}` —
and passes the same conformance suite as the other two. It is split per table
the way the SQLite adapter is, and the SQL is written by hand behind one
connection file rather than through a query builder or an ORM: the hard part is
the filter compiler, which neither Kysely nor Drizzle models, and both bind a
JavaScript object as a `jsonb` parameter, which is the P0 trap below.

**The tables are §6.2's**, with the composite keys and cascades unchanged, and
three Postgres choices:

- every text column is `COLLATE "C"`, so names, ids and timestamps compare and
  sort by codepoint whatever the database's locale (D92; the test database's
  default, `English_India.utf8`, sorts `a` before `B` and U+FFFD first), and
  the `(collection_id, id)` primary key serves `ORDER BY id`;
- `data` is `jsonb`, the fastest form to store and query, and `schema` is
  `text`, so it comes back byte for byte: the order of its `properties` is the
  admin form's field order;
- `rev` and `seq` are `bigint`, which the driver returns as strings.

**Search is `PgSearcher` (D95)**, an `IndexedStorage` engine like FTS5, over
one more table, `entry_search`, keyed like `media_references` and cascading
from `entries`. Its row is written inside `put`'s transaction from
`DerivedIndex.search`, so an entry and its index row land together; system
data is refused there as well as by the caller.

- **`unicode61` is a hand-written `tsvector`** (`PgSearchDocument`): the
  terms `SearchTokens.tokenize` gives — folded, split on anything not a letter
  or a number, never stemmed — each with its positions, the label's weight A
  and the body's B. Not `to_tsvector`: Postgres's parser keeps a URL, an
  e-mail address or `e-mail` whole and would need a configuration chosen to
  stem nothing, a second tokenizer to keep in step with the first. The query
  is a hand-written `tsquery` from the same `SearchTokens.parseQuery` — every
  term required, the last a prefix (`:*`) — so a user typing `not` searches
  for "not", and no configuration can read the two sides differently. A term
  longer than a lexeme's 2047 bytes is left out of the index, and a query
  holding one matches nothing.
- **Ranking** is `ts_rank_cd` with weights `{0, 0, 0.1, 1}`, the 10:1 label to
  body that bm25 and the scan use (measured: 1.0 for a label hit, 0.1 for a
  body one). It is not FTS5's score, and the tests compare which entries come
  back and that a label hit ranks first, never scores.
- **`trigram` is `pg_trgm`**: the folded label and body are stored as text,
  with a GIN `gin_trgm_ops` index on each, and every term must be a substring
  of one of them (`LIKE '%term%'`; a term under three characters is still
  answered, by scanning). A label match counts 10 and a body match 1. Folding
  both sides makes `cafe` find `Café`, which SQLite's `trigram` tokenizer does
  not do. Without the extension the store refuses to open and names the
  `CREATE EXTENSION`, rather than install one into the operator's database
  unasked; the operator class is qualified with the extension's own schema.
- **The stamp** is `postgres-<engine>:<SearchText.Version>:<tokenizer>` in
  `meta`. A moved stamp drops and recreates the table under the DDL lock, and
  the store reports a rebuild due whenever nothing is indexed while a user
  collection holds entries — which `SiloRuntime` runs before the bind, as it
  does for FTS5. Search off clears the stamp and drops nothing, for the reason
  `SearchIndex.disable` gives.
- **The query** joins the index row to its entry and to the three record
  tables through renamed subqueries (`SqliteSearcher.Joins` explains why), and
  takes the access plan in the same statement through `ClaimSegment.postgres`,
  which is `ClaimSegment.sql` with numbered placeholders and `starts_with`
  for a prefix (Postgres has no `GLOB`; `LIKE` would read an id's `_` as a
  wildcard). Page and total are one statement, as in `list`, and a search takes
  a scan slot like one.
- **`reindex`** pages each collection through the store and writes 200 rows
  per statement from one JSON parameter, skipping a row whose entry went since
  the page was read. **`check`** reports rows missing their tokenizer's text,
  and the two anti-joins `SqliteSearcher.check` runs.

**Every table is qualified in the SQL** (`"silo"."entries"`), never reached
through `search_path`, so no statement depends on session state that a pooler
in transaction mode would not carry between transactions. The schema name's
grammar is what makes splicing it safe.

**Opening** checks the server — 14 or later, since 13 and older are past their
end of life — waiting up to `[storage] startup_wait` (60 s) for one that is not
there yet (`PgStartup`, below), then runs one transaction that takes
`pg_advisory_xact_lock(hashtext('silo.ddl'), hashtext(<schema>))`, guards the
format, creates what is missing and seeds `meta` and the `_system` records.
The lock is there because `CREATE ... IF NOT EXISTS` is not safe against a
concurrent create — two first starts would race on a catalog unique index —
and a test opens two stores on one empty schema at once to pin it. The schema
is created only when absent, so a role without `CREATE` on the database can
use one a DBA made. The guard is stricter than SQLite's in one way: a table
with one of silo's names in a schema with no `format_version` stamp is refused,
because the schema may be shared with another application and `CREATE TABLE IF
NOT EXISTS` would otherwise adopt its table. The system records are seeded on
every open, so a collection a newer binary reserves reaches an existing schema.

**The driver's rules live in `PgConnection`**, the only file that imports it,
from the P0 measurements:

- `prepare: false`, because Bun otherwise keeps every distinct statement text
  prepared on its session (102 after 100 shapes) and a compiled filter has a
  new text nearly every call;
- parameters are only strings, numbers, booleans and null. JSON goes in as
  text cast in SQL (`$1::text::jsonb`): with prepared statements a string cast
  with `::jsonb` alone is stored as a jsonb *string*, and an object parameter
  is refused. A list goes in as one JSON array read back with
  `jsonb_array_elements_text`, so no value depends on how the driver
  serialises a composite and a page of any size is one fixed statement text;
- every error leaves through `PgErrorMap`, by SQLSTATE: `23505` is a
  `ConflictError`, `23503` a `NotFoundError` on insert (the collection went
  between the lookup and the write) and a `ConflictError` on delete, `22021`
  and `22P05` (a NUL) a `ValidationError`, and a timeout, a full server, a
  shutdown, a serialization failure, a deadlock or a lost connection a
  `PgUnavailableError` — a `StorageBusyError`, so `503` with `Retry-After`,
  that also says why (`connection`, `contention`, `unreachable`, `busy`,
  `unknown`), which is what the retry rules below read. Anything else stays a
  500. SQLite lets a raw constraint race through as a 500; this does not copy
  that.

**Transactions** are one `sql.begin` per port method, and nothing but that
method's own statements is awaited inside one. `put` takes the next `seq` from
the `meta` counter row with `UPDATE ... RETURNING`, not from a `SEQUENCE`: the
row lock is held to commit, so the next writer waits, `seq` has no gaps and
its order is commit order — which a change feed (D6) needs. Twenty concurrent
`put`s take 1 to 20. The new `seq` is written onto the caller's entry after the
commit, not before it. Record creates are `INSERT ... ON CONFLICT DO NOTHING`
followed by a read, so two requests creating one name at once both get the one
record rather than one of them a unique violation; a `putSchema` that loses
that race becomes an update of the winner's record.

**The name cache** is `SqliteScopeResolver`'s, with one addition, because a
lookup here awaits: a record write can commit while a lookup is in flight, and
the lookup would then cache the old answer after the write had cleared it. So
`clear` also advances a generation, a lookup caches only if no clear happened
while it ran, and record writes clear before and after (`invalidating`), which
closes the gap between the commit and the second clear.

**The compiler** answers what `SqliteCompiler` and `FsFilter` answer (D29,
D92), and the conformance suite holds the three together:

- a selected field is a `jsonb` expression, SQL NULL when the path selects
  nothing, reached one step per selector — `-> $n::text` for a name and
  `-> 3` for an index. `#>` takes both as text and would read key `"0"` of an
  object for index 0, or element 0 of an array for a name `"0"`;
- `eq` and `in` are `jsonb = jsonb`, which is type-strict by itself: `1` is not
  `"1"` or `true`, and JSON null equals only JSON null;
- every comparison and cast sits inside a `CASE` on `jsonb_typeof`, because SQL
  fixes no evaluation order for `AND` and casting a string to `numeric` is an
  error, not a false. Numbers bind as text cast to `numeric`, so
  `0.30000000000000004` is not rounded through `float8`;
- a wildcard is one `EXISTS` over `jsonb_array_elements` and `jsonb_each`, each
  handed NULL for any other type by a `CASE` — both return no rows for NULL, so
  a scalar, a missing path and an empty container select nothing;
- sorts never use raw `jsonb`, whose type order is not `EntryNodes.compare`'s:
  one key is a type rank and one value per sortable type, and within a rank
  only one of the three values is non-null;
- a value no stored node can hold matches nothing rather than being bound — a
  non-finite number (`JSON.stringify` would bind it as `null`), `NaN` in a
  range (it orders above everything in `numeric`), and a string `PortableData`
  would refuse (the driver would turn a lone surrogate into U+FFFD and match
  that). A range against such a string is a `ValidationError`, since "less
  than a string no adapter stores" has no answer the other two share;
- a leaf that compiles to `false` drops the parameters its path bound
  (`PgParams.rewind`), because Postgres refuses a parameter the statement never
  uses (`42P18`).

**A page and its total are one statement**: the count is a scalar subquery
beside the page, so both come from one snapshot in one round trip. The total is
unknown only when the page is empty, and past the last page it is then asked
for on its own.

**One server owns a schema** (D25). `RunFile` guards a data directory, but two
servers with different data directories can share a database, and the rev
checks, the `seq` order, the name cache and the write lock would then all be
wrong with nothing noticing. `PgStore.claimOwnership` takes
`pg_try_advisory_lock(hashtext('silo.owner'), hashtext(<schema>))` on a
connection of its own, outside the pool — a session lock belongs to its
connection, and a pooled one would hand it to whatever ran there next — and
refuses at once, naming the schema, when another server holds it. Another
schema in the same database has an owner of its own.

The store offers this as `OwnedStorage`, an optional capability like
`IndexedStorage`, and `SiloRuntime.open` claims it for `serve` straight after
opening storage — before the resume of a pending rename, which writes — while
one-shot commands (`keys`, `export`, …) take no lock, as they take no run file.
Losing the lock's connection loses the lock, so a heartbeat runs `SELECT 1` on
it every ten seconds. When that fails, every write is refused as `503` while
the lock is taken again on a new connection; if another server took it in
between, `lost` is called, `serve` logs it and shuts down with exit 1, and the
store refuses writes until it does. A write can still land in the window
between the connection breaking and the next beat, at most ten seconds; that
is the window this design accepts rather than asking the lock on every write.

**Connections** (`[storage]`, seconds, `0` for no limit): `pool_size` (10),
`connect_timeout` (10), `startup_wait` (60), `idle_timeout` (60, under most
proxies' and serverless databases' own cut-off), `max_lifetime` (1800, so a
failover or a DNS change is picked up), `statement_timeout` (30) and
`idle_in_transaction_timeout` (60). The last two are startup parameters, so
the server enforces them. `url` has no default and is a `secret` field: the
settings API reports it with the password masked (`ConfigSecrets`), and
`SILO_STORAGE_URL` is the place to put it.

- **No `client_connection_check_interval`.** It would end a query whose
  client has gone, but a Windows server refuses it at connect ("must be set to
  0 on this platform"), and Bun then raises the refusal as an unhandled
  rejection, which would take `serve` down. `statement_timeout` bounds such a
  query instead.
- **Waiting at startup** (`PgStartup`): a refused connection, an unknown host,
  a server still starting (`57P03`) or one with no connection to spare is
  retried with backoff (250 ms doubling to 5 s) until `startup_wait` runs out,
  and the error then names the host, never the URL. A wrong password or a
  missing database is refused at once.
- **Retries** (`PgConnection`), at most three, jittered from about 50 ms. A
  `SELECT` whose connection broke is run again. A transaction is run again
  from the start when its connection broke before its `work` had finished, or
  on a serialization failure or a deadlock, both of which the server rolled
  back — so every transaction's `work` must be safe to repeat, which the
  upserts, `ON CONFLICT DO NOTHING` creates and the counter row already make
  it. A connection lost *while a commit is in flight* is never retried: the
  write may have landed, so it is a `503` that says to read before trying
  again. A single-statement write outside a transaction is not retried, so the
  entry delete and the project create run in one to get the rule. After a
  backend is killed the pool heals on the next statement, which P0 measured
  and a test pins.
- **Scans leave room for writes** (`PgScanGate`). Every `list` — its page and
  its count read the whole collection — takes one of `pool_size - 2` slots
  (at least one). Up to 64 more wait, and the next is refused as `503 busy`,
  so a flood of slow filters degrades listing and search and nothing else,
  which is D81's promise on SQLite kept without a thread: a query here does not
  block the JS thread. A test holds the only slot and shows a write landing
  while a second list is shed.
- **Shutdown fits `serve`'s five-second exit.** Bun's own `close` drops
  statements in flight (measured: a 250 ms query cut at 0 ms), so
  `PgConnection.close` refuses new work, waits up to four seconds for the work
  already running, then closes. `PgStore.close` refuses the queued scans
  first, and gives the owner lock up **after** the pool is closed, so no write
  of this server's can land once another server has the lock.
- **Observability.** The store is `MeasuredStorage` too: `GET
  /api/observability` carries `storage.database` — the bytes silo's tables
  take, the pool's in-use, waiting, shed, retry and failure counts, and the
  owner lock's state — sampled on the same thirty-second cache as the
  directory walk. It is `null` for `sqlite` and `fs`.

A pooler in transaction mode cannot keep a session lock, so PgBouncer needs
session mode, and it refuses the two timeout parameters unless they are in its
`ignore_startup_parameters` (then set them on the role). That setup is not
tested yet.

**Testing.** `SILO_TEST_PG_URL` names a database; unset, the Postgres tests
are skipped and say so. Every test gets a `silo_test_<ulid>` schema and drops
it, and a close test checks `pg_stat_activity` holds no session with the
store's `application_name` afterwards. `postgres-connections.test.ts` does the
damage for real, on sessions named for the test alone: a killed backend
inside a transaction and under an idle pool, a raised `40001`, a statement
past its timeout, an unreachable port and a wrong password at startup, a
drained and a cut-off close, a held scan slot, a killed owner connection taken
back by the heartbeat, a rival that takes the lock first, and `serve` refusing
a second server. `postgres-search.test.ts` holds the engine to what
`sqlite-search.test.ts` holds FTS5 to; its trigram half installs `pg_trgm`
into a schema of its own when the database lacks it, and drops that schema
afterwards, so the database is left as it was found. Two things were found on
the way: the
conformance context now closes its last store in an `afterAll`, since an open
pool keeps the test process alive after the last test; and Bun 1.4.2's
`expect(...).rejects` crashed the runner (a segfault, or a spin at full CPU)
when it awaited a refused `PgStore.open` after the conformance run, so the
Postgres-only tests take a rejection with a plain `try`/`catch`
(docs/context/code-design.md, Tests).
