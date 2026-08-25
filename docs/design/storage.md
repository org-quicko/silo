# Storage adapters

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 6. Storage adapters

### 6.1 Interface

```go
type Storage interface {
    // Schemas — scoped to (project, env) since D18
    PutSchema(ctx context.Context, scope Scope, collection string, schema json.RawMessage) error
    GetSchema(ctx context.Context, scope Scope, collection string) (json.RawMessage, error)
    ListSchemas(ctx context.Context, scope Scope) (map[string]json.RawMessage, error)
    DeleteSchema(ctx context.Context, scope Scope, collection string) error // fails if entries exist, unless forced at a higher layer

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

    // Every non-system scope currently holding a schema or an entry, sorted by
    // (project, env). Scope existence is derived from content, never registered.
    ListScopes(ctx context.Context) ([]Scope, error)

    // Media usages (D23). Derived state owned by the adapter: SQLite keeps a
    // media_references table written inside Put's existing transaction, the fs
    // adapter scans entry files and stores no index. Delete/DeleteProject/
    // DeleteEnvironment drop matching usages as part of the same operation.
    ListMediaUsages(ctx context.Context, mediaIDs []string, limit, offset int) ([]MediaUsage, int /*total*/, error)
    CountMediaUsages(ctx context.Context, mediaIDs []string) (map[string]int, error)

    // Every collection in this scope that still holds an entry, sorted by name.
    // Deliberately distinct from ListSchemas: an archive can carry
    // content/<collection>/ with no schema, and those entries are invisible to
    // every schema-derived listing — without this the scope they live in can
    // never be emptied.
    ListEntryCollections(ctx context.Context, scope Scope) ([]string, error)

    // Instance metadata (instance_id, last_seq). seq stays instance-global and
    // monotonic across every scope.
    Meta(ctx context.Context) (Meta, error)

    Close() error
}
```

Seq assignment lives in the adapter because it must be atomic with the write. A future `Changes(sinceSeq)` method will be introduced as an *optional* interface (`interface{ Changes(...) }` upgrade check) so v1 adapters don't have to implement it.

Adapters assume **one process owns a data directory**, which is enforced above
them at the process boundary rather than by any of them (D25): `Storage` has no
cross-process lock, the fs adapter holds `last_seq` in memory, and `Service`'s
write mutex is process-local. `RunFile.assertNotRunning` is what makes that
assumption true.

Rules for all adapters: single-writer semantics per entry, atomic writes (no torn entries observable), `List` results stable-ordered (sort keys, then `id`), the project/env existence rule of D20 (created explicitly *or* still holding content — a scope reported by one adapter and not the other is a portability bug, since `Exporter` enumerates `listScopes()`), and **`project`/`env`/`collection`/`id` validated as safe path segments** (`EntryUtils.assertSafeSegment`: non-empty, not `.`/`..`, no `/`, `\`, or NUL, ≤255 bytes) on every entry call. That last rule is a port contract rather than one adapter's local defense: the fs adapter turns these values into a path, so an unvalidated `id` from an import archive could otherwise plant an entry outside its scope or outside the data dir entirely — and a cap the fs adapter can't honor would let SQLite accept what fs rejects mid-write with `ENAMETOOLONG`. Both adapters therefore reject the same values, and the conformance suite pins that. Since D18, `$ref`/`$defs` resolution, the compiled-validator cache, and referrer checks (§9) are likewise scoped — the same collection name in two scopes never shares a validator or resolves a ref against the other's schemas.

### 6.2 SQLite adapter

```sql
CREATE TABLE meta    (key TEXT PRIMARY KEY, value TEXT NOT NULL); -- instance_id, last_seq, format_version
CREATE TABLE schemas (
    project    TEXT NOT NULL,
    env        TEXT NOT NULL,
    collection TEXT NOT NULL,
    schema     TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project, env, collection)
);
CREATE TABLE entries (
    id         TEXT NOT NULL,
    project    TEXT NOT NULL,
    env        TEXT NOT NULL,
    collection TEXT NOT NULL,
    rev        INTEGER NOT NULL,
    seq        INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data       TEXT NOT NULL,           -- JSON
    PRIMARY KEY (project, env, collection, id)
);
CREATE INDEX idx_entries_seq ON entries(seq);
CREATE TABLE media_references (          -- D23; derived, rebuilt by `silo media reconcile`
    media_id   TEXT NOT NULL,            -- asset ULID, or "blob:<key>" for a pre-D23 reference
    project    TEXT NOT NULL,
    env        TEXT NOT NULL,
    collection TEXT NOT NULL,
    entry_id   TEXT NOT NULL,
    PRIMARY KEY (media_id, project, env, collection, entry_id)
);
CREATE INDEX idx_media_refs_entry ON media_references(project, env, collection, entry_id);
CREATE TABLE entry_search_documents (   -- D30; derived, rebuilt by `silo search reindex`
    docid      INTEGER PRIMARY KEY,     -- explicit: VACUUM renumbers an implicit rowid
    project    TEXT NOT NULL,
    env        TEXT NOT NULL,
    collection TEXT NOT NULL,
    entry_id   TEXT NOT NULL,
    label      TEXT NOT NULL,           -- weighted text (x-silo-search.label)
    body       TEXT NOT NULL,
    UNIQUE (project, env, collection, entry_id)
);
CREATE INDEX idx_entry_search_scope ON entry_search_documents(project, env, collection);
CREATE VIRTUAL TABLE entry_search_fts USING fts5(  -- external content; 3 sync triggers
    label, body, content = 'entry_search_documents', content_rowid = 'docid',
    tokenize = '<[search] tokenizer>'
);
```

`media_references` and `entry_search_documents` rows are written inside `put`'s existing transaction — the
one that already allocates `seq` — so an entry, its references and its index row land together
or not at all. `delete`, `deleteProject` and `deleteEnvironment` drop matching
rows in their own transactions for the same reason.

The search tables exist only when `[search] enabled` is true **and** the SQLite build has FTS5, which is probed at open rather than assumed. `docid` is an explicit `INTEGER PRIMARY KEY` because `VACUUM` renumbers the implicit rowid of a table whose primary key is composite, which would silently point the index at the wrong rows; the upsert uses `ON CONFLICT DO UPDATE` so it survives a rewrite. Opening with search **disabled** clears the version stamp but drops nothing — every CLI subcommand opens the store, so a `silo keys list` from a build without FTS5 would otherwise delete the index a running server is maintaining on the same data dir, and a cleared stamp already forces the rebuild that correctness needs.

WAL mode, `busy_timeout` set, one write connection + a read pool. `seq` allocated by incrementing `meta.last_seq` inside the write transaction, still instance-global rather than per-scope. Filters compile to `json_extract(data, '$.path')` expressions; no per-field indexes in v1 (roadmap: expression indexes for declared hot fields). Scope values (`project`, `env`) always reach SQL as bound parameters, never interpolated, same as every other query value. `SqliteStore.open` refuses to open a data dir stamped with a different `format_version` before running DDL — `CREATE TABLE IF NOT EXISTS` would otherwise silently leave a pre-D18 schema/entries table without these columns in place, so unscoped queries would crash on "no such column" instead of failing with an actionable message. The `meta.format_version` row is checked first, but isn't trusted alone: a pre-D18 db could in principle have old-shaped tables without a `format_version` row to contradict, so the guard also inspects `schemas`/`entries` directly via `PRAGMA table_info` and refuses to open if either exists without a `project` column.

### 6.3 Filesystem adapter (layout = export format, per D5)

Since D18 (`format_version` `"2"`), every collection lives under its
`(project, env)` pair:

```
<data-dir>/
  manifest.json                     # format_version, instance_id, last_seq
  projects/
    <project>/
      <env>/
        schemas/
          posts.schema.json         # the JSON Schema document, pretty-printed
        content/
          posts/
            01J8XQ4Z8K9M2P3R5T7V9X1B3D.json
    _system/
      _system/
        content/
          _keys/                   # system collections live in the reserved scope
            01J8XQ50P1R2S3T4U5V6W7X8Y9.json
```

The reserved system scope (`_system/_system`) is just another `<project>/<env>` pair — the adapter has no branch for it. `listScopes()` walks the `projects/*/*` directory pairs, skips any whose names start with `_`, and reports a pair only if it still holds a schema or an entry — a directory left behind by deleting a scope's last collection is not a scope. Scope existence is derived from content on every adapter, never registered.

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
