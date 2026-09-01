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
assumption true.

Rules for all adapters: single-writer semantics per entry, atomic writes (no torn entries observable), `List` results stable-ordered (sort keys, then `id`), the **record existence rule of D51** — a project, environment or collection exists exactly when its record does, superseding D20's "created explicitly *or* still holding content"; a scope reported by one adapter and not the other is a portability bug, since `Exporter` enumerates `listScopes()` — and **`project`/`env`/`collection`/`id` validated as safe path segments** (`EntryUtils.assertSafeSegment`: non-empty, not `.`/`..`, no `/`, `\`, or NUL, ≤255 bytes) on every entry call. That last rule is a port contract rather than one adapter's local defense: the fs adapter turns these values into a path, so an unvalidated `id` from an import archive could otherwise plant an entry outside its scope or outside the data dir entirely — and a cap the fs adapter can't honor would let SQLite accept what fs rejects mid-write with `ENAMETOOLONG`. Both adapters therefore reject the same values, and the conformance suite pins that. Since D18, `$ref`/`$defs` resolution, the compiled-validator cache, and referrer checks (§9) are likewise scoped — the same collection name in two scopes never shares a validator or resolves a ref against the other's schemas.

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

WAL mode, `busy_timeout` set, one write connection + a read pool. `seq` allocated by incrementing `meta.last_seq` inside the write transaction, still instance-global rather than per-scope. Filters compile to `json_extract(data, '$.path')` expressions; no per-field indexes in v1 (roadmap: expression indexes for declared hot fields). Scope values (`project`, `env`) always reach SQL as bound parameters, never interpolated, same as every other query value. `SqliteStore.open` refuses to open a data dir stamped with a different `format_version` before running DDL — `CREATE TABLE IF NOT EXISTS` would otherwise silently leave an older entries table without these columns in place, so queries would crash on "no such column" instead of failing with an actionable message. The `meta.format_version` row is checked first, but isn't trusted alone: an older db could in principle have old-shaped tables without a `format_version` row to contradict, so the guard also inspects the shape directly. Since D51 that means two things: a `schemas` table existing **at all** is proof of a pre-D51 directory, since nothing creates it any more; and `entries` is inspected via `PRAGMA table_info` for a `collection_id` column. D51 reset `format_version` to `"1"` and there is **no migration** — export with the previous binary and re-import, per the pre-1.0 principle D29 states.

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

A project or environment rename is a single `fs.rename` of the directory, atomic on one filesystem, with the marker travelling untouched. **A collection rename is the one that is not**: the marker, the schema file and the content directory are three moves. So the destination marker carries `moving_from`, written before the first move and cleared after the last, and `FsCollectionStore.resumePending` finishes it at the next open, counting failures rather than throwing — the same reasoning D23's and D49's resumes give. Recovery is *decidable* precisely because the id is in both places: a destination marker holding **this** id is this rename half-done and is resumed, while any other id is a genuine collision. `putSchema` writes the schema **before** the marker for a related reason — a crash between the two then leaves a schema file no listing reports, which the next put adopts, where the other order would leave a collection that lists and has no schema, the one state the `NOT NULL` invariant exists to rule out.

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

**Frozen-format consequence (accepted in D5):** no sharded directories, no on-disk indexes, no binary formats — ever — without a `format_version` bump and migration tooling. Pre-1.0, that bump itself is cheap: D18 broke the layout outright (flat → `projects/<p>/<e>/...`) with no migration path, matching the project's pre-1.0 stance that breaking changes are expected rather than shimmed. `FsStore.open` refuses a data dir stamped with a different `format_version` rather than misreading it as the new tree.

### 6.4 Blob storage, and changing it from the admin (D16, D45)

Media bytes go through `BlobStorage`, a six-method port with two shipped
adapters — `FsBlobStorage` (a directory) and `S3BlobStorage` (S3 and anything
speaking its API, built on Bun's own `S3Client`) — resolved by driver name
through `ProviderRegistry` exactly as the `Storage` adapters are, so a provider
plugin's driver reaches the same lookup the built-ins do (§13.7).

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
in the instance, including uploads made by keys it has no `media:read` over, and
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

**`base_url` roots media URLs somewhere other than the request.** Unset, a media
field resolves against the origin the request arrived on — the only origin known
to be reachable by whoever asked, and the reason D35 returns `""` for a
plugin-dispatched request rather than inventing one. Set, it is that value
instead, which is what an instance behind a CDN or serving a custom CMS domain
needs. It must be absolute http(s): a relative base would resolve against
whatever origin the reader happened to have, which is what leaving it empty
already does, and only one of the two says so.

**`base_url_target` decides the shape of the path under it,** and the choice is
architectural rather than cosmetic:

- **`server`** — `<base>/media/<id>`. silo stays in the read path, the bucket
  stays private, and the asset is addressed by **catalog id**, so the URL
  survives a rename and is derivable from the reference alone. That derivability
  is what keeps `EntryUtils.toApiResponse` a pure synchronous function, which is
  what makes resolving a page of entries free.
- **`store`** — `<base>/<blob key>`. The bucket or a CDN over it serves the
  bytes and silo is not consulted, which is the only shape that works for a
  reader that cannot authenticate and will not follow silo's cache headers —
  an email client, above all. It needs a publicly readable bucket, and it costs
  a catalog lookup, because a blob key lives on the record rather than in the
  reference. That lookup is done **once per response, before the entries are
  mapped** (`MediaLinkResolver`), never inside the mapping; in `server` mode it
  does no I/O at all. An asset whose key was not resolved falls back to silo's
  own origin rather than to `base_url`, since the CDN has never heard of
  `/media/<id>` and a link rooted there would 404 — D35's judgement again.

Neither reaches backwards: changing the base does not rewrite a URL already
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
images, video, audio and PDF — with `svg` included and carrying the one caveat
worth repeating in the file: an SVG is a document that can run script, and
`/media/{id}` serves it inline from silo's own origin.

**What does not change is D23.** Blob keys stay flat and folders stay catalog
metadata even in `store` mode, where the key is the public path. Mirroring
folders into the bucket was considered and refused: S3 has no rename, so a move
would become a copy-and-delete of the bytes and would break every URL already
published for that file — the two costs D23 was written to avoid, in exchange
for a bucket listing that reads more tidily in a console.
