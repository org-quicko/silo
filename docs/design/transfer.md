# Export, import and copy

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 7. Export / import

### 7.1 Formats

- `silo export --dir <path>` writes the §6.3 tree — every scope that holds content, plus `_system` when `--with-keys` is set (the `--with-keys` rule for `_keys` is otherwise unchanged; scope-filtered export, e.g. `--project`/`--env`, is a later phase — export today is always instance-wide).
- `silo export --out <file>.tar.gz` writes the same tree as a tarball, entries ordered by (collection, id) so archives are reproducible byte-for-byte given identical data.
- If the running instance already uses the fs adapter, export is effectively a copy — and users can skip export entirely and `rsync` the data dir.

`manifest.json` in an export additionally records: `exported_at`, `silo_version`, and per-collection entry counts — since D18, `collections` is keyed by `"<project>/<env>/<collection>"` rather than by bare collection name, so the same name in two scopes gets two independent counts.

- `--with-config` includes `config.json` (sanitized: no secrets/tokens). Default **off** — config is instance-specific (ports, paths).
- `_keys` is excluded by default. `--with-keys` includes it — hashes only, so a cloned instance accepts the same secrets. Useful for true replicas; off by default so a content export handed to someone never ships credentials. Projects and envs that hold nothing yet are addressing, not credentials, and are never gated: `listScopes()` reports them (D20), and they ride along as empty `projects/<p>/<e>/` directories, so the project list is not the one thing an export cannot reproduce.
- Export runs through the `Storage` interface, so it works identically on any adapter, and is also exposed as `GET /api/export` (`transfer:export`), which **streams** the tarball as its response body. This is the one place the "no full-dataset buffering" claim used to be aspirational: the route read the finished archive into a single `Buffer` before answering, and since the archive is assembled in a temp tree that holds a copy of every media byte (§8.1), a whole-instance export needed as much memory as the media library takes on disk — so on a small host it failed outright rather than merely running slowly. `tar.c` is now gzipped straight into the response and no intermediate `.tar.gz` is written at all, so peak memory is one gzip chunk. The temp tree is removed when the response ends, errors, or the client disconnects mid-download. The export *walk* still completes before the first byte is sent, which is what keeps a storage or blob failure an error response instead of a truncated archive. The bytes are unchanged: the same reproducible tarball `--out` writes.
- `media/` stays a top-level directory in the archive, unaffected by scoping — media is instance-global (§8.1), not per-project/env. Since D23 the bytes travel with their catalog: `_media` and `_media_folders` ride in `_system` and are **never** gated on `--with-keys`, because filenames and folders are data, not credentials. Blob keys stay flat, so the directory layout is unchanged.

### 7.2 Import

`silo import <dir|tarball> [--mode merge|replace] [--validate]` (also `POST /api/import`, admin).

- The importer walks `projects/<project>/<env>/{schemas,content}` (`ImportWalker`, since D18) rather than a single flat `schemas/`+`content/` pair. The scope comes from the path — an entry's `project`/`env` fields are set from the directory it was found in, not trusted from the file's own contents, so the path is the addressing authority.
- **Since D51 the archive also carries record ids, in the markers**: `.silo-project`, `.silo-env`, and `schemas/.<collection>.silo-collection`, each `{id, created_at}`. `Exporter` writes them and `ImportWalker` reads them, which is what lets a round trip preserve identity rather than minting a new id for every record it restores. The conflict matrix is one rule with one exception: **the path is still the addressing authority**, so a name that already exists at the destination keeps the destination's id and the archive's is ignored; a name that does not exist takes the archive's id when it is well-formed and free, and a freshly minted one when the adapter refuses it — which is what lets two instances that each minted their own `blog` still exchange archives, where a duplicate id failing the whole import would not. A hand-assembled directory tree with no markers at all still imports; every id is minted.
- **A `content/<name>/` directory with no `schemas/<name>.schema.json` beside it is now refused, by name.** Silo used to accept it, and `listEntryCollections` existed so those entries stayed addressable. A collection's schema is `NOT NULL` since D51, so the state is unrepresentable — and inventing a permissive `{"type":"object"}` to satisfy the column would silently accept anything into a collection the operator believes is validated. This is a **format tightening**: an archive from an older silo that carries such a directory will not import.
- **A project holding no environment at all is finally exported.** `listScopes()` answers `(project, env)` pairs and so could never name one, and `Exporter` walked only that — so such a project was silently dropped from every archive. It now walks `listProjects()` too, writing the project directory and its marker.
- **Replace mode no longer deletes a schema before re-putting it.** It did, and under record keying that destroys the collection record and mints a new id for the same collection, losing the identity the destination already had. `putSchema` replaces the schema in place and keeps the row.
- **`replace`** — for each `(scope, collection)` pair present in the archive: delete the local collection (schema + entries) **in that scope only**, then load. A same-named collection in a different scope is untouched, and pairs absent from the archive are untouched.
- **`merge`** (default) — match by `(scope, collection, id)`. Missing locally → insert. Present both sides → **newest `updated_at` wins** (tiebreak: higher `rev`, then lexically greater source instance_id — deterministic on both sides). `--prefer local|remote` overrides. Schemas merge the same way using their `updated_at`.
- Imported entries keep their `id`, `rev`, timestamps, and scope (`project`/`env` from the path). `seq` is **reassigned locally** (seq is per-instance, never portable).
- The importing instance **keeps its own `instance_id`** — cloning data does not clone identity.
- **Validation off by default** on import: fidelity first — the source instance accepted this data, possibly under an older schema. `--validate` opts into strict checking; it validates each entry against its own scope's schema.
- The `_keys` guard is scope-aware only in the sense that it looks for `_keys` under any scope in the archive — an archive containing `_keys` anywhere still requires the importing key to hold `keys:import` (`ForbiddenError` otherwise), same as before D18.
- **Legacy archives** — not applicable pre-1.0: an unrecognized `format_version` is rejected outright (§6.2/§6.3), never migrated. D18 bumped the format to `"2"` with no dual-format reader.
- **An archive is streamed in, not buffered.** `/api/import` takes the request body as a stream and feeds it straight to `tar.x`, so no intermediate `.tar.gz` is written and nothing bigger than one chunk is held: the mirror of the export change in §7.1, and for the same reason — an archive carries every media byte, so reading one whole cost as much memory as the *source* instance's library. Both shapes of upload are accepted: a raw body, which is what the admin sends and the only truly streaming one, and a `multipart/form-data` `file` part, which is still bounded by whatever the runtime does with a large form since the part cannot be found without parsing the body that holds it. The *extracted* tree still lands in a temp dir, because `importDir` walks a directory and an archive is not ordered for a single pass. A truncated upload fails with the gzip error itself and extracts nothing, so it cannot half-import — which is a sharper failure than §7.2's non-atomicity warning covers, not an exception to it.
- **Imports are not atomic.** There is no transaction spanning the walk: an archive that fails partway (a rejected path segment per §6.1, a disk error) leaves everything written up to that point in place, and the caller gets the error instead of an `ImportResult`, so the counts of what landed are lost. Failing loudly mid-import is the deliberate trade against the alternative — accepting malformed addressing to keep the run going — but it means a failed import must be treated as "unknown state, re-run or restore", not "no-op". `--dry-run` walks and reports without writing, which is the way to check an untrusted archive first. Atomic import would need either a staging area or a transactional `Storage` method, neither of which exists pre-1.0.

### 7.3 Direct server copy

`POST /api/copy` (`transfer:copy`) pulls `/api/export` from another running silo and feeds
that archive to the same importer used by file uploads. The pull is **streamed end to
end** — the source streams its export and the destination loads from that stream, where
it used to read the response into a `Buffer` first and so undo the source's streaming on
the receiving side. The one thing the buffered form got for free was noticing an empty
archive; that check is kept by peeking the first chunk and putting it back at the head of
the stream, so an empty source is still a clear error rather than a tar failure. The
request supplies the
source base URL, a source API key with `transfer:export`, merge/replace mode, dry-run, conflict
preference, and whether `_keys` should be included. Schemas, entries, and media
are always copied. Source credentials are used only for the outbound export
request and are not stored on the destination.

Data-only copy excludes `_keys`, preserving destination access. Data-plus-keys
merge adds/updates source key hashes; replace removes destination keys before
loading the source keys. After a replace-with-keys operation, the supplied
source key is therefore the credential that can access the destination.
Including `_keys` requires `keys:export` on the source and `keys:import` on the
destination.

### 7.4 Cross-adapter migration

Because export/import speak only `Storage`, migrating backends is: `silo export` on the old instance, `silo import --mode replace` on the new one. This doubles as the acceptance test for every new adapter.

### 7.5 Known limitation: deletions don't merge

v1 has no tombstones, so a deletion on instance A is not propagated by merging A's export into B — only `replace` mode reflects deletions. Documented loudly. Tombstones arrive with the sync design (§12.1).
