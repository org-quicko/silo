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
- Export runs through the `Storage` interface, so it works identically on any adapter. It streams (no full-dataset buffering) and is also exposed as `GET /api/export` (`transfer:export`) returning the tarball.
- `media/` stays a top-level directory in the archive, unaffected by scoping — media is instance-global (§8.1), not per-project/env. Since D23 the bytes travel with their catalog: `_media` and `_media_folders` ride in `_system` and are **never** gated on `--with-keys`, because filenames and folders are data, not credentials. Blob keys stay flat, so the directory layout is unchanged.

### 7.2 Import

`silo import <dir|tarball> [--mode merge|replace] [--validate]` (also `POST /api/import`, admin).

- The importer walks `projects/<project>/<env>/{schemas,content}` (`ImportWalker`, since D18) rather than a single flat `schemas/`+`content/` pair. The scope comes from the path — an entry's `project`/`env` fields are set from the directory it was found in, not trusted from the file's own contents, so the path is the addressing authority.
- **`replace`** — for each `(scope, collection)` pair present in the archive: delete the local collection (schema + entries) **in that scope only**, then load. A same-named collection in a different scope is untouched, and pairs absent from the archive are untouched.
- **`merge`** (default) — match by `(scope, collection, id)`. Missing locally → insert. Present both sides → **newest `updated_at` wins** (tiebreak: higher `rev`, then lexically greater source instance_id — deterministic on both sides). `--prefer local|remote` overrides. Schemas merge the same way using their `updated_at`.
- Imported entries keep their `id`, `rev`, timestamps, and scope (`project`/`env` from the path). `seq` is **reassigned locally** (seq is per-instance, never portable).
- The importing instance **keeps its own `instance_id`** — cloning data does not clone identity.
- **Validation off by default** on import: fidelity first — the source instance accepted this data, possibly under an older schema. `--validate` opts into strict checking; it validates each entry against its own scope's schema.
- The `_keys` guard is scope-aware only in the sense that it looks for `_keys` under any scope in the archive — an archive containing `_keys` anywhere still requires the importing key to hold `keys:import` (`ForbiddenError` otherwise), same as before D18.
- **Legacy archives** — not applicable pre-1.0: an unrecognized `format_version` is rejected outright (§6.2/§6.3), never migrated. D18 bumped the format to `"2"` with no dual-format reader.
- **Imports are not atomic.** There is no transaction spanning the walk: an archive that fails partway (a rejected path segment per §6.1, a disk error) leaves everything written up to that point in place, and the caller gets the error instead of an `ImportResult`, so the counts of what landed are lost. Failing loudly mid-import is the deliberate trade against the alternative — accepting malformed addressing to keep the run going — but it means a failed import must be treated as "unknown state, re-run or restore", not "no-op". `--dry-run` walks and reports without writing, which is the way to check an untrusted archive first. Atomic import would need either a staging area or a transactional `Storage` method, neither of which exists pre-1.0.

### 7.3 Direct server copy

`POST /api/copy` (`transfer:copy`) pulls `/api/export` from another running silo and feeds
that archive to the same importer used by file uploads. The request supplies the
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
