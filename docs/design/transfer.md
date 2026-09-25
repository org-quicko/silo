# Export, import and copy

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 7. Export / import

### 7.1 Formats

- `silo export --dir <path>` writes the §6.3 tree — every scope that holds content, plus `_system` when `--with-keys` is set (the `--with-keys` rule for `_keys` is otherwise unchanged). `--include` narrows it; see §7.6.
- `silo export --out <file>.tar.gz` writes the same tree as a tarball, entries ordered by (collection, id) so archives are reproducible byte-for-byte given identical data.
- If the running instance already uses the fs adapter, export is effectively a copy — and users can skip export entirely and `rsync` the data dir.

`manifest.json` is written **last**, which is what lets every number in it count what was actually written rather than what was expected to be. It records `exported_at`, `silo_version`, the `selection` this archive was taken under (absent means the whole instance — §7.6), a `media` block (§7.7), and per-collection entry counts — since D18, `collections` is keyed by `"<project>/<env>/<collection>"` rather than by bare collection name, so the same name in two scopes gets two independent counts.

- `--with-config` includes `config.json` (sanitized: no secrets/tokens). Default **off** — config is instance-specific (ports, paths).
- `_keys` is excluded by default. `--with-keys` includes it — hashes only, so a cloned instance accepts the same secrets. Useful for true replicas; off by default so a content export handed to someone never ships credentials. Projects and envs that hold nothing yet are addressing, not credentials, and are never gated: `listScopes()` reports them (D20), and they ride along as empty `projects/<p>/<e>/` directories, so the project list is not the one thing an export cannot reproduce.
- Export runs through the `Storage` interface, so it works identically on any adapter, and is also exposed as `GET /api/export` (`transfer:export`), which **streams** the tarball as its response body.

  **There is no temp tree and no staging pass (D73).** The archive used to be assembled into a temp directory and then handed to `tar.c`, which made *time to first byte the length of the entire export*. That is not a performance note; it is what broke the route. On a real instance the walk downloads every media byte from the blob store — 1,619 objects and 68 seconds on the deployment that found this — and a connection that closes when it goes quiet had long since been closed (§10.3). The handler then ran to completion and logged its own `200` for a client that had left a minute earlier, while the proxy in front reported `upstream prematurely closed connection while reading response header`. Every symptom named the proxy; none of them named the cause.

  So the walk writes through an **`ExportSink`** instead, and there are two of them: `DirectoryExportSink` for `--dir`, and `TarExportSink` over a `TarWriter` that emits POSIX ustar entries as they arrive. Silo writes tar itself rather than delegating it because entries have to be produced one at a time from values, not from files already on disk; reading an archive is still `tar.x`, so only the writer is ours. A path longer than the ustar `name` field is carried by a preceding PAX record, which is what `projects/<project>/<env>/content/<collection>/<id>.json` needs with unremarkable names. First byte now leaves in milliseconds, and peak memory is one entry rather than one media library.

  **Gzip is `node:zlib`, not the web `CompressionStream`** (D76). The web stream
  accepts every chunk it is offered and holds the result, so however carefully
  the walk above it is paced the response still costs what the archive weighs:
  measured at 583 MB for 500 MB of blobs, against 67 MB for the same bytes
  through the tar writer alone. `node:zlib` answers `false` from `write` when
  its buffer is full and emits `drain` when it is not, which is the signal the
  walk needs. With it in the chain a 500 MB archive exports at a **147 MB** peak,
  flat, and the same budget writes it to a file — a `FileSink` is flushed on a
  byte budget rather than trusted to `write`, which answers a count and not a
  promise until it decides to flush on its own.

  **The cost is stated rather than hidden.** A storage or blob failure now arrives *after* the response has begun, so it truncates the body instead of becoming an error status. A truncated archive fails its own gzip check at the far end and extracts nothing, so it cannot half-import — the same property §7.2 relies on for a truncated upload. The trade is deliberate: "a clean error after 68 seconds of silence" was not available, because the silence was the failure.

  **Reproducibility is now real rather than claimed.** Ordering was always fixed; the mtimes were not, because they were the clock at the moment the staging files were written. Every entry is stamped with the export's own `exported_at`, so two exports of unchanged data are identical byte for byte.
- `media/` stays a top-level directory in the archive, unaffected by scoping — media is instance-global (§8.1), not per-project/env. Since D23 the bytes travel with their catalog: `_media` and `_media_folders` ride in `_system` and are **never** gated on `--with-keys`, because filenames and folders are data, not credentials. The directory stays **flat**, which since D88 is a thing the archive keeps rather than a thing a blob key is: a key is `media/<id>`, and its prefix is that directory rather than part of the entry's name, so the prefix is stripped on the way out and put back on the way in. Which key an entry goes back to is decided by the archive's own `_media` rows, not by its name — a row saying `<id>.jpg` loads to `<id>.jpg`, one saying `media/<id>` loads to `media/<id>`, and a blob no row claims keeps its own name. That is what lets an archive written before D88 load unmigrated and an older silo go on reading one written after it, with no `format_version` bump on either side.

### 7.2 Import

`silo import <dir|tarball> [--mode merge|replace]` (also `POST /api/import`, admin).

- The importer walks `projects/<project>/<env>/{schemas,content}` (`ImportWalker`, since D18) rather than a single flat `schemas/`+`content/` pair. The scope comes from the path — an entry's `project`/`env` fields are set from the directory it was found in, not trusted from the file's own contents, so the path is the addressing authority.
- **Since D51 the archive also carries record ids, in the markers**: `.silo-project`, `.silo-env`, and `schemas/.<collection>.silo-collection`, each `{id, created_at}`. `Exporter` writes them and `ImportWalker` reads them, which is what lets a round trip preserve identity rather than minting a new id for every record it restores. The conflict matrix is one rule with one exception: **the path is still the addressing authority**, so a name that already exists at the destination keeps the destination's id and the archive's is ignored; a name that does not exist takes the archive's id when it is well-formed and free, and a freshly minted one when the adapter refuses it — which is what lets two instances that each minted their own `blog` still exchange archives, where a duplicate id failing the whole import would not. A hand-assembled directory tree with no markers at all still imports; every id is minted.
- **A `content/<name>/` directory with no `schemas/<name>.schema.json` beside it is now refused, by name.** Silo used to accept it, and `listEntryCollections` existed so those entries stayed addressable. A collection's schema is `NOT NULL` since D51, so the state is unrepresentable — and inventing a permissive `{"type":"object"}` to satisfy the column would silently accept anything into a collection the operator believes is validated. This is a **format tightening**: an archive from an older silo that carries such a directory will not import.
- **A project holding no environment at all is finally exported.** `listScopes()` answers `(project, env)` pairs and so could never name one, and `Exporter` walked only that — so such a project was silently dropped from every archive. It now walks `listProjects()` too, writing the project directory and its marker.
- **Replace mode no longer deletes a schema before re-putting it.** It did, and under record keying that destroys the collection record and mints a new id for the same collection, losing the identity the destination already had. `putSchema` replaces the schema in place and keeps the row.
- **`replace`** — for each `(scope, collection)` pair present in the archive: bring the local collection to the archive's content **in that scope only** — every row the archive carries is written over what is there, then every row it does not carry is removed (D85; it used to be emptied first, see the atomicity note below). A same-named collection in a different scope is untouched, and pairs absent from the archive are untouched.
- **`merge`** (default) — match by `(scope, collection, id)`. Missing locally → insert. Present both sides → **newest `updated_at` wins** (tiebreak: higher `rev`, then lexically greater source instance_id — deterministic on both sides). `--prefer local|remote` overrides. Schemas merge the same way using their `updated_at`.
- Imported entries keep their `id`, `rev`, timestamps, and scope (`project`/`env` from the path). `seq` is **reassigned locally** (seq is per-instance, never portable).
- The importing instance **keeps its own `instance_id`** — cloning data does not clone identity.
- **Every entry is validated, and there is no flag** (D70). `--validate` and its HTTP and copy-body equivalents are gone; the importer builds a `SchemaValidator` unconditionally and judges each entry against its own scope's schema. System collections are still exempt — they carry `{"x-silo-system": true}` and nothing validates against it.
- **A refused entry is skipped, not fatal.** Fidelity still wins here, just not silently: the old default let an archive written under an older schema through whole, and aborting instead would make one stale row cost an entire restore. `ImportResult` therefore carries `rejected` — always present, exact — and a `rejections` list of `{project, env, collection, id, reason}` capped at `Importer.RejectionLimit` (100), so a schema tightened in one place does not answer with a message per row. The CLI prints the count and the named ones; the admin names the affected collections with a count each.
- **A merge that would change a populated collection's schema is a `409`** (D70), from the same `SchemaChangeGuard` the API uses. Replace mode is exempt because it deletes the entries first, and a collection the destination does not have yet is exempt because there is nothing to invalidate. The guard runs on a **dry run** too, so the refusal is predicted rather than met at apply time — for merge, where the count it reads is the one the real run would read.
- **The `_system` half is gated per collection (D84).** `_keys` anywhere in the archive still requires `keys:import`, as before D18. The media catalog — `_media`, `_media_folders`, `_media_folder_moves` — requires `media:create` whether or not bytes ride, and `media:delete` when a replace would empty it. `_variables` rows require `create` and `entries:update` over the whole project they belong to — what declaring and valuing a variable ask for — translated through the archive's own project markers; a row naming a project the archive does not carry is asked at the instance. `_audit`, `_plugins`, `_scope_renames` and any `_system` name silo does not know are refused as a `400`, since `ExportSystem.rides` never writes them and an archive carrying one was not written by silo. `ImportSystemGate` reads `ImportGrants`, which the HTTP routes derive from the caller's claims and the CLI sets to trusted; it judges rows, not schemas, so an export that merely describes an empty library loads with no system grant. Until D84 only `_keys` was gated, and the 2026-09-18 audit (H3) showed a key with write on one collection forging `_audit` and planting `_variables`.
- **Legacy archives** — there is no dual-format reader: an unrecognized `format_version` is rejected outright (§6.2/§6.3), never migrated. 1.0 ships stamp `"1"`, and reading anything else is a decision a future major release would have to make deliberately.
- **An archive is streamed in, and spooled once** (D78). `/api/import` takes the request body as a stream. It used to feed that straight to `tar.x` and claim nothing bigger than one chunk was held; measured, a 750 MB copy peaked at **2.0 GB** of private memory on the destination, because `Unpack` keeps accepting entries while it writes them out and so absorbed the archive as fast as it arrived. The upload is therefore spooled to one file with a flush budget and extracted from **that**, where tar pulls at its own pace — 516 MB private for the same copy, against a baseline near 390 MB. The spool costs the archive's size in disk, which a small host has and which the extracted tree needed beside it anyway, and it is removed before the entries are loaded. What the original claim was reaching for still holds: the mirror of the export change in §7.1, and for the same reason — an archive carries every media byte, so reading one whole cost as much memory as the *source* instance's library. Both shapes of upload are accepted: a raw body, which is what the admin sends and the only truly streaming one, and a `multipart/form-data` `file` part, which is still bounded by whatever the runtime does with a large form since the part cannot be found without parsing the body that holds it. The *extracted* tree still lands in a temp dir, because `importDir` walks a directory and an archive is not ordered for a single pass — **under the data directory** (`<data>/transfer/`) rather than the platform temp directory, which on a hardened systemd unit is a RAM-backed tmpfs inside `PrivateTmp` while the data directory is the disk provisioned for exactly this much content. `ImportOptions.stagingDirectory` names it; absent, the platform default stands. A truncated upload fails with the gzip error itself and extracts nothing, so it cannot half-import — which is a sharper failure than §7.2's non-atomicity warning covers, not an exception to it. **Since D85 the spool and the extraction are bounded, and neither holds the write lock.** The spool is held to `[transfer] max_archive_size_mb` as it arrives, and the extraction to `max_extracted_size_mb` as tar hands each header to `ArchiveExtractor`'s filter — every entry costing at least one 4 KB block plus its header, so a million empty files are refused as well — with the first overspend aborting the parser before the entry is written; both are `413 archive_too_large` (§10.5 in configuration.md). And `TransferService` calls `Importer.stage` — spool, unpack, discard on failure — **before** `withWriteLock`, holding the lock for `importDir` alone, where it used to hold it from the first byte: a caller who sent an archive slowly, inside the idle timeout, held every write on the instance for as long as they liked (the audit's H5).
- **An archive's entries are read as they are written, not before** (D77). `ImportWalker` used to hand the importer an `Entry[]` per collection, so the whole archive's content was parsed into memory before a single row landed — a destination receiving a copy peaked at roughly twice the archive, which is the side of a transfer a small host is least able to absorb. `ImportEntries` replaces the array: the walk records that a `content/<collection>/` directory exists, and the importer pulls its files one at a time when it reaches that collection. Nothing else moved, because the importer already worked one collection and one entry at a time; only the shape it was handed did. A scope copy passes `ImportEntries.of`, since it reads from storage and has nothing to defer. The file *names* are still listed eagerly — the directory has to be read to know what is in it — and names are small where entries are not. One thing moves with it: a malformed entry file used to fail during the walk, before anything was written, and now fails when the importer reaches it. That is the non-atomicity below rather than a new hazard, and `--dry-run` still reads every entry, so the pass that exists to judge an untrusted archive before applying it is unchanged.

- **Media goes to the store the instance is configured with**, never to a directory derived from the data path. Every transfer entry point takes `BlobStorage | string` and builds an `FsBlobStorage` for the string; the services pass `context.blobStorage`, which is the live store and repointable while the process runs (D45). One caller passing a path instead would send an import's media to local disk on an S3 instance and nothing would say so until the URLs stopped resolving, so it is pinned by a test that hands the destination a recording store and asserts the local directory stays empty.

- **Imports are not atomic, and since D85 an interrupted one never leaves a collection empty.** There is no transaction spanning the walk: an archive that fails partway (a rejected path segment per §6.1, a disk error) leaves everything written up to that point in place, and the caller gets the error instead of an `ImportResult`, so the counts of what landed are lost. Failing loudly mid-import is the deliberate trade against the alternative — accepting malformed addressing to keep the run going — but it means a failed import must be treated as "unknown state, re-run or restore", not "no-op". `--dry-run` walks and reports without writing, which is the way to check an untrusted archive first. Replace mode used to make the state far worse than "unknown": it emptied each collection and then refilled it, so a full disk, an OOM kill or a stop between the two left the collection with nothing in it and nothing coming (the 2026-09-18 audit's H6). It now writes every row the archive carries over what is there and removes the rest afterwards (`Importer.prune`, ids collected before anything is deleted), so an interruption leaves rows the archive did not name beside the ones it did, and the next run removes them; `deleted` still counts what was there and `added` what the archive carried, and a row the schema refuses is pruned rather than kept as it was. A transaction on the `Storage` port was considered and not taken: the fs adapter has none to offer, and the reorder removes the loss on both adapters.

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
preference, and whether `_keys` should be included. Source credentials are used
only for the outbound export request and are not stored on the destination.

Since D74 the body also carries `include` and `media` (§7.6, §7.7). `include` is
forwarded to the source's own `/api/export` rather than only applied on arrival,
which is the point of having it here at all: copying one collection should not
make the source assemble the whole instance first. `media: none` is the answer
for two instances sharing one bucket, where moving bytes the destination can
already read is pure waste.

Data-only copy excludes `_keys`, preserving destination access. Data-plus-keys
merge adds/updates source key hashes; replace removes destination keys before
loading the source keys. After a replace-with-keys operation, the supplied
source key is therefore the credential that can access the destination.
Including `_keys` requires `keys:export` on the source and `keys:import` on the
destination.

### 7.4 Cross-adapter migration

Because export/import speak only `Storage`, migrating backends is: `silo export` on the old instance, `silo import --mode replace` on the new one. This doubles as the acceptance test for every new adapter.

### 7.4.1 Scoped copy selection and preview

`POST /api/projects/{project}/envs/{env}/copy` may name a non-empty
`selection` of source collections. An omitted selection preserves the legacy
whole-scope operation; a selected collection carries its schema and all its
entries, and `entry_ids` narrows that collection to a non-empty set. Entry
subsets are merge-only because replace deletes an entire destination
collection. Both HTTP and `ScopeCopier` reject malformed, duplicate, reserved,
or missing names and ids before a write.

A dry run can request `detail_offset` and a capped `detail_limit`. Its additive
`scope_copy` result reports per-collection schema actions and totals, plus one
bounded page of labelled entry actions. The importer records the decisions it
actually makes, rather than a second preview simulation. Destination entry ids
in deletion detail require destination read claims; otherwise the result keeps
the count and redacts the ids.

### 7.5 Known limitation: deletions don't merge

v1 has no tombstones, so a deletion on instance A is not propagated by merging A's export into B — only `replace` mode reflects deletions. Documented loudly. Tombstones arrive with the sync design (§12.1).

### 7.6 Selecting what moves (D74)

Export, import and copy share one vocabulary for *what a transfer covers*: a set
of `project`, `project/env` or `project/env/collection` rules. An empty set is
the whole instance, which is also what an absent parameter means — the two
arrive indistinguishably over a query string, so "nothing matches" is
deliberately not representable.

- **`GET /api/export?include=…`** — repeatable, one rule per occurrence, so a
  rule never has to be escaped against a separator of its own and a selection
  reads the same in an address bar as in `curl`.
- **`POST /api/import?include=…`** — the same rules, deciding what is *loaded*
  from an archive that may hold more.
- **`POST /api/copy`** with an `include` array — forwarded to the source's
  `/api/export`, so the source never walks what the destination would discard,
  and applied again on the way in.
- **`silo export --include` / `silo import --include`** — repeatable flags.

`TransferSelection` is the one parser and the one matcher. Every id is validated
before a single storage read, so a malformed rule cannot half-export. A system
collection can **never** be named: what rides from `_system` is decided by the
media mode and by `with_keys`, and a selection that could name `_keys` would be
a second, unguarded way past the keys claim. Overlapping rules are a union
rather than a conflict.

**Three depths and no fourth.** Entry-level subsets stay on
`POST /api/projects/{p}/envs/{e}/copy` (§7.4.1), where they are already
merge-only because replace deletes an entire destination collection. A partial
collection inside a whole-instance archive would make the manifest's counts
ambiguous and would have to carry that same restriction into a route whose whole
purpose is replacing things.

**Claims follow the reach.** With no selection the archive routes keep
`requireInstanceWide` — holding `transfer:export` alone would otherwise hand a
key scoped to one project a way straight out of it. With one, `TransferAuth`
asks only for what each rule names: `{project}/*​/*`, `{project}/{env}/*` or the
one collection. This is the rule the scoped copy route has used since D22,
applied to the archive routes now that they can be narrowed. `with_keys` is the
exception and still demands instance-wide read, because keys are instance-global
however narrow the content selection is.

An import's selection narrows **content** and the variable declarations
belonging to the projects it drops — variables are keyed by project id (D57), so
a declaration whose project is not being loaded has nothing to resolve against.
The media catalog rides as the archive holds it: the archive is already the
product of an export that made that choice, and re-deriving it here would be a
second implementation of the same rule.

### 7.7 Media modes (D74)

What a transfer does about media bytes is a separate question from what it
covers, and `media=all|referenced|none` answers it for all three operations.

| mode | catalog rows | bytes |
|------|--------------|-------|
| `all` | every row | every blob in the store, catalogued or not |
| `referenced` | only rows the transferred entries point at | those rows' blobs |
| `none` | every row | none |

The mode decides the catalog subset as well as the bytes, so the two cannot
disagree — an archive never describes an asset it neither carries nor left
behind on purpose. References are found with `MediaRefs.extract`, the same
structural extractor the delete guard uses, so "referenced" means exactly what
it means everywhere else, legacy `/media/<blobKey>` forms included.

**The defaults are the interesting part.** A whole-instance export defaults to
`all`, because "export everything" has to stay lossless: dropping an upload
nothing currently points at would make the default export quietly unable to
restore the library it came from. A *selective* one defaults to `referenced`,
because naming one collection and receiving the entire media library is not what
that asked for. Both are expressible either way; only the default moves.

`none` exists for the case the deployment that prompted all this is in: two
instances pointing at one S3 bucket, where copying 60 MB of bytes the
destination can already read is pure waste. The catalog still rides, so
filenames, folders and URLs survive, and `ImportResult.media.files` reports `0`
rather than pretending. Loading those catalog rows still needs `media:create`
(D84): the route asks for the claim up front only when bytes ride, and
`ImportSystemGate` asks for it again once the archive shows what it carries.

**Replace mode is scoped to what the archive is authoritative for**, which is
the correctness fix this made unavoidable. Replace used to clear *every blob in
the destination* whenever an archive had a `media/` directory, and to empty
`_media` because that collection appeared in the archive. Before selections
existed every archive was the whole instance, so both were right by accident.
The moment a partial archive exists they are a data-loss bug: exporting one
collection and restoring it with `--mode replace` would wipe a library and put
back the handful of files that collection happened to reference.
`ImportAuthority` is the one predicate. A content collection always qualifies —
the archive names the (scope, collection) pair. `_system` qualifies only when
the archive is whole *and* is being loaded whole, and `_media` additionally
requires that the archive was not taken with `media: referenced`. Clearing the
**blobs** is stricter by one mode still: an archive taken with `media: none` is
authoritative for what the library contains and carries none of it, so deleting
the destination's bytes on its word would destroy the very files it is counting
on already being there.

### 7.8 Progress streams (D75)

An export answers immediately now (§7.1). An import and a copy cannot: the
request body is in long before the destination has finished extracting and
writing, and a copy's connection is idle for the *whole* pull. On any connection
that closes when it goes quiet, that is how a succeeding transfer comes to look
exactly like a failing one.

So both routes accept `Accept: application/x-ndjson` and answer with a
line-delimited stream instead of one JSON body: a `progress` line whenever the
importer reports (every 200 entries, and at each phase boundary), a bare
heartbeat after a second of silence, and a final `result` or `error` line. The
counts on a progress line are the live `ImportResult` — the same object the final
answer is built from — so a progress line and the result cannot describe
different runs.

**The status code goes out before the work begins**, which is what sending the
first byte early costs. A failure is therefore the `error` line, carrying the
status it would have been, and a caller reads the last line rather than the
status. That is why it is opt-in: nothing already reading the JSON body changes,
and a caller that asks for the stream is a caller that has agreed to read it.
`X-Accel-Buffering: no` and `Cache-Control: no-store` go out with it, because
anything downstream that collected the stream into a buffer would undo the one
thing it is for.

A stream that ends with no `result` line is reported as such rather than as a
success with zero counts: the connection died mid-run, the destination's state is
unknown, and §7.2's "re-run or restore" warning is the honest answer.

A job model with polling would survive a page reload and support cancellation,
which this does not. It is the right next step and is deliberately not this one:
it needs durable job state, a listing, a GC policy and claims of its own, none of
which the failure this fixes requires.
