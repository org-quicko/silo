# Export, import and copy

> Part of silo's design spec. The decisions log (D1–…) that governs it
> is [decisions.md](decisions.md), indexed in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

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
- `media/` stays a top-level directory in the archive, unaffected by scoping — media is instance-global (§8.1), not per-project/env. Since D23 the bytes travel with their catalog: `_media` and `_media_folders` ride in `_system` and are **never** gated on `--with-keys`, because filenames and folders are data, not credentials. The directory stays **flat**, which since D88 is a thing the archive keeps rather than a thing a blob key is: a key is `media/<id>`, and its prefix is that directory rather than part of the entry's name, so the prefix is stripped on the way out and put back on the way in. Which key an entry goes back to is decided by the archive's own `_media` rows, not by its name — a row saying `<id>.jpg` loads to `<id>.jpg`, one saying `media/<id>` loads to `media/<id>`, and a blob no row claims keeps its own name. The same row gives what the object is stored as: its `content_type`, and a `Content-Disposition` naming its `filename`, as an upload stores them, because a bucket that serves the object answers without silo. A blob no row claims gets neither. Before this, an import wrote bare bytes, so a bucket served a `media/<id>` object as `application/octet-stream` and an SVG did not draw; `silo media rekey --rewrite` repairs a library imported that way. That is what lets an archive written before D88 load unmigrated and an older silo go on reading one written after it, with no `format_version` bump on either side.

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
- **A merge that would change a populated collection's schema is a `409`** (D70), from `SchemaChangeGuard.assert` — stricter than the API's save, which admits a change every stored entry satisfies (`assertEntriesFit`); an import's entries arrive with the schema, so judging the old ones alone could refuse an import that would leave only fitting data. Replace mode is exempt because it brings every row to the archive's content, overwriting or pruning it, and a collection the destination does not have yet is exempt because there is nothing to invalidate. The guard runs on a **dry run** too, so the refusal is predicted rather than met at apply time — for merge, where the count it reads is the one the real run would read.
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

**A plain export is a copy, not a move** (D97). It leaves behind what silo keeps for the instance itself — the audit log, the plugin grants, the managed keys minted for them and, since D111, the transfer ledger — because an archive is the one artifact that leaves an instance, and those belong to the instance rather than to its content. Changing driver is the one case where that is wrong: the destination *is* the same instance. `silo export --instance` is that case. It carries everything a whole export does, every key (managed ones too, since the grant that names each travels with it), `_plugins` and `_audit`, and stamps `instance: true` in the manifest. It refuses `--include` and `--media referenced`, since a move is whole, and refuses while a `_scope_renames` marker is pending, since the marker never travels and the content would arrive half renamed. On the way in, `ImportSystemGate` loads `_audit`, `_plugins` and `_transfers` only from an archive stamped `instance` **and** only for `ImportGrants.Trusted`, which is the CLI: no claim reaches it, so no key — root included — can rewrite the trail or grant a plugin through `POST /api/import`. An archive carrying either without the stamp is refused as before, and `--include` against a move is refused too, since part of one would bring grants and keys for plugins whose content stayed behind. There is no separate migrate command: `--dry-run` already previews the import, and the import result already names every entry the destination's schemas refused. The operator's steps are in `resources/guide/configuration.md`, *Changing the storage driver*.

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

### 7.9 Transfer packages (D108)

Copying selected content from an environment of one instance into an
environment of another starts at the source, and the rule there is that what
was not picked never leaves. `POST /api/copy` cannot keep it: its archive goes
three depths deep and no further (§7.6), so picking three posts out of a
thousand would ship the thousand and the media they all use, and a refresh from
prod would hand a lower stage prod entries nobody chose. A transfer package is
the answer: `POST /api/projects/{project}/envs/{env}/package` with
`{collections: [{name, entry_ids?}], media}`.

- **Exactly what was named.** The tree is §6.3's, cut to one scope: the project
  and environment markers, each named collection's schema and marker, and its
  entries — all of them for an item with no `entry_ids`, exactly those for an
  item with them. Variables, keys, folder moves and every other `_system` row
  stay behind; the destination's own settings are not the source's to send.
- **Media is the closure of the entries, or nothing.** With `referenced` (the
  default) the package carries each asset the entries point at that is
  `active` and whose bytes the store holds, the bytes themselves, and the folder
  records of every folder above those assets. "Point at" is `MediaRefs.extract`,
  legacy blob tokens included, so it means what §7.7 means. Every reference the
  package could not satisfy — no row, a row being deleted, or bytes gone — is
  listed in `missing_media`, so the destination can say so before anything is
  applied. With `none` the package carries no catalog row and no byte, which is
  stricter than an archive's `none`: the destination finds its own unresolved
  references. `all` is refused, since a package is never the library.
- **Refused before the first byte, never widened.** Every name and id is checked
  first: malformed, reserved or repeated is a `400`, absent from the scope a
  `404` naming what is missing, and only then does the body start. A source too
  old to know the route answers `404` for the route itself, so there is no older
  behaviour to fall back to. An entry deleted while the package streams
  truncates it, and a truncated package fails its gzip check at the far end.
- **`package.json`, not `manifest.json`.** It records `package_version` (`1`),
  the source's `silo_version` and `instance_id`, the scope, the echoed selection
  with a count per collection, the media mode, what media rode and
  `missing_media`, and it is written last so the counts are what was written.
  The name is the safety: `Importer` refuses a tree holding `package.json` with
  a `400` saying it is a transfer package, and every older silo refuses it for
  having no `manifest.json`. Without that, an operator who saved a package and
  loaded it with `POST /api/import?mode=replace` would empty every collection
  of all but the picked entries — the hazard §7.6 kept entry subsets off the
  archive routes to avoid.
- **Claims are a narrowed export's** (§7.6): `transfer:export`, plus
  `schema:read` and `entries:read` on each named collection. No media claim, for
  the reason D58 gives.

The route only produces. The destination's half — fetching a package, checking
it against what was asked for, planning it against its own state, and applying
it through `AtomicStorage.commit` — is the prepared transfer (§7.10).

### 7.10 Prepared transfers (D109)

The destination's half starts with a saved package. `POST
/api/projects/{project}/envs/{env}/transfers` with `{source: {url, api_key},
from: {project, env}, selection: [{collection, entry_ids?}], mode, prefer,
media}` pulls the source's package (§7.9) once, verifies it, and keeps it. The
review reads that package and nothing else, and Apply will write that package
and nothing else, which is Terraform's `plan -out` / `apply planfile` and the
opposite of the env copy's preview, whose own copy warns that live edits may
shift its numbers. The route names the destination, the body the source, as
`/api/copy` and the env copy do, and `from` and the route's env may differ:
`acme/dev` lands in `acme/uat`.

- **Everything refusable is refused before the source is contacted.** The
  claims first: `transfer:copy`, because this server reaches outside itself,
  which the env copy (D22) never does; the env copy's write claims on each
  selected collection at the destination; its replace claims in `replace`
  mode; `media:create` unless `media` is `none`. Then the body, by the source
  route's own rules (`TransferPackageSelection.parse`), plus the env copy's rule
  that an entry subset is merge-only. Then the destination environment, which
  must exist: a transfer fills an environment, it does not create one, and the
  package's own markers name the source's records. Then the store, which must
  offer `AtomicStorage.commit` (D107): the fs adapter answers `409
  atomic_commit_unsupported`, since a promise of one change is not one it can
  keep (§6.1 of storage.md). Then a slot. Only then is the source asked.
- **Pulled as an upload is.** `Importer.stage` spools and unpacks under
  `[transfer]`'s two ceilings (D85), which matter more here than for `/api/copy`
  because the source can be any server. Redirects are refused. A body that is
  not `application/gzip` is refused unread. A `404` with no silo error in it, or
  silo's own route-miss `not found`, is a server without the route, so the
  answer says the source needs silo 1.6.0; any other refusal is the source's
  own message. A connection that breaks mid-pull, and a body that will not
  unpack, are `400`s about the source, not `500`s about this server.
- **Verified exactly, or deleted** (`TransferPackageVerifier`,
  `TransferPackageMediaCheck`). Only plain files and folders, judged by the
  listing's own file types: a symbolic link in a package could name any file on
  this host, and following it would hand that file to the review or to Apply as
  content. At the top only `package.json`, `projects/` and, with `referenced`,
  `media/`; under `projects/` only the `from` project and, with `referenced`,
  `_system`. The schemas are exactly the selection's; content folders are a
  subset of it; each entry file is named by its id, holds that id and a valid
  envelope, and an item with `entry_ids` holds exactly those. `package.json`
  must name version `1`, the `from` scope, the media mode and the selection,
  and its counts must be the counted ones. Under `_system` only `_media` and
  `_media_folders`: each asset row answers for a reference some packaged entry
  holds (`MediaRefs.extract`, the source's rule) and is `active`; each row has
  its file in `media/` and `media/` holds nothing else; each file has its row's
  size and sha256; a blob key is one plain name, never a path; each folder row
  is normalised, unique and above a carried asset; and `missing_media` is
  exactly what the rows leave unresolved. Any difference deletes the transfer,
  record included, so a source that sends too much does not keep a slot.
- **Kept on local disk**, under `<data>/transfer/prepared/<id>/`: `record.json`
  (written through a synced temporary file and a rename), the verified
  `package/`, and, once planned, `plan.ndjson` (§7.11), which the review pages
  a line at a time. Local disk is right because
  one process owns a data directory (D25, D94). The same fact makes the
  process's own list of running pulls authoritative: a `preparing` record that
  no pull in this process owns was left by one that stopped, and is removed the
  next time anything reads the transfers.
- **Bound to its key and scope.** Every read and the cancel answer only the key
  that prepared the transfer, under the environment it was prepared for, and
  still ask for `transfer:copy`. Anyone else gets a `404`, not a `403`, so a
  transfer id is not something another key can confirm.
- **Bounded in number and time**, by constants rather than settings for now.
  A prepared transfer expires 60 minutes after it was prepared and loses its
  package. At most 4 may be preparing, prepared or applying; the fifth is `429
  too_many_transfers`, with no `Retry-After` because a slot frees when someone
  acts. An ended record (cancelled, expired, and later applied or stale) stays
  24 hours, so a client that lost a response can read the outcome, and is then
  removed. All of it is applied when transfers are read, so no timer runs.
- **States**: `preparing`, `prepared`, `applying`, `applied`, `stale`,
  `cancelled`, `expired`. A cancel of a running pull aborts its fetch, the
  staged files go, and the prepare answers `409 transfer_cancelled`; a cancel of
  a prepared one drops the package and keeps the record. A cancel of one that is
  applying or applied is a `409`.
- **The source key is never written down.** It lives in the `HttpPackageSource`
  that makes the one pull; the record holds the source's normalised URL.
- **Progress** is the D75 stream on `Accept: application/x-ndjson`, and its
  first line names the transfer, so a client can cancel by id while the pull
  runs. Without the header the answer is `201` with the transfer.
- **The review.** `GET …/transfers/{id}?detail_offset=&detail_limit=` answers
  the record, the package summary, the review and one page of the plan (at
  most 100; §7.11).
  `GET …/transfers/{id}/entries/{collection}/{entry}` answers one packaged entry
  raw, as the editor reads entries (no media URLs, no variables), addressed to
  the destination. Neither reads the source again, so neither moves when the
  source does.

**What it opens.** There is no source allowlist: any silo may be a source. A
key holding `transfer:copy` can therefore make this server send a `POST` to any
address it can route to, which is the server-side request forgery `/api/copy`
already carries (audit finding H7), now through a second route that also sends
a JSON body. What limits it is what limits `/api/copy`: credentials, a query or
a fragment in the URL are refused, redirects are refused, and a body that is
not `application/gzip` is refused unread, though a refusal's message can carry
the `error.message` of a JSON error body. Give `transfer:copy` only to the
people who release content, and keep egress rules on the host. An allowlist
(`[transfer] copy_sources`) was designed and left out of 1.6.0 by choice.

The plan (§7.11) is what the review shows and what Apply will write.

### 7.11 The plan (D110)

A prepared transfer is planned as soon as its package is verified, against the
environment it was prepared for. Planning reads the destination and writes
nothing, so it takes no write lock; the baseline it records is what lets Apply
see a change made since.

- **One set of rules.** `ImportRules` holds the decisions an import makes.
  `schema()`: create a collection that is absent, update in `replace`, and in
  `merge` update only a schema that differs, unless `prefer: "local"` keeps the
  destination's; only that last update is guarded (D70). `incomingWins()`:
  `prefer` when given, else the later `updated_at`, then the higher `rev`, then
  the higher instance id. `Importer` and `TransferPlanner` both call them, so an
  archive import, an env copy and a transfer decide the same input the same
  way. The importer's flow is otherwise as it was, and so are its tests.
- **Re-addressed.** The package's paths name the source scope. The planner
  reads them there and plans, as Apply will write, into the route's
  environment. The package's project, environment and collection markers are
  ignored: a transfer fills an environment that exists, and a collection it
  creates takes a fresh id, as in the env copy (D22), because the source's id
  can belong to a collection here under another name.
- **Checked against the effective schema.** An import writes the schemas and
  then validates entries against the stored ones. A plan that becomes one
  commit cannot do that, so each entry to be written is checked against the
  scope's schemas as they will stand: the package's where the plan writes the
  schema, this environment's where it does not (unchanged, or kept by
  `prefer: "local"`). `SchemaValidator.validateEntryAgainst` compiles from that
  map, with the same protocol checks (D62, D92). A skipped entry is not judged,
  as the importer does not judge it. A refused entry is a `rejected` line
  carrying the validator's message, and Apply will not write it. A schema that
  does not compile is a `400`. A merge that would change what validates a
  collection holding entries fails the preparation with the guard's `409`, and
  the transfer is removed.
- **Lines and counts.** `plan.ndjson` replaces D109's entry index: one line per
  packaged entry, by collection and then id, followed in `replace` by one
  `deleted` line per destination row the package does not carry. A line names
  its action (`added`, `updated`, `skipped`, `rejected`, `deleted`), the
  packaged `rev` and time, and the destination row it was planned against
  (`seq`, `rev`, `updated_at`), if there was one. The record's `review` holds
  the totals per collection, counted as the importer counts them, so a transfer
  and an env copy of the same content read the same: `replace` counts every
  destination row as `deleted`, overwritten or removed, and the lines say
  which.
- **The baseline**, which Apply turns into D107's preconditions: each line's
  destination `seq`, or that there was no row; each collection's record id and
  `updated_at`, which a schema write and a rename both move, or that there was
  no collection; in `replace`, the exact set of rows (`rows: "listed"`); and,
  for a merge whose schema change the guard let through only because the
  collection was empty, that it is still empty (`rows: "none"`). A skipped or
  rejected line is part of it too, so anything the review described that has
  moved makes the transfer stale. Planning reads row by row rather than from
  one snapshot, and that is enough: Apply checks every observation in one
  transaction, so it commits only when all of them hold at once. The review
  also records the destination's project and environment ids
  (`review.destination`, never shown), because every other observation is
  relative to a scope name.
- **What a reader sees.** A page answers each line without its `seq`. What
  only the destination holds, the id on a `deleted` line and any line's
  destination `rev` and time, is shown only to a key holding the env copy's
  read claims (`:schema:read`, `:entries:read`) on that collection here, judged
  at each read, as the env copy's preview hides destination ids (§7.4.1). The
  collection baselines are never shown.
- **Progress** gains a `plan` phase after `verify`.

Media is planned with the content, by `TransferMediaPlanner`, under the rules
of §7.12 (D111): its lines follow the entries', and each entry line names the
references it holds that will not resolve here.

### 7.12 Apply (D111)

`POST …/transfers/{id}/apply` writes the plan (§7.11) as one commit, or
nothing. It takes no body: everything it acts on was fixed when the transfer
was prepared.

- **The claims, again.** The route asks for `transfer:copy`, then for the write
  claims prepare asked for, as the key holds them now. A key that lost one
  since the review is a `403`, and the transfer stays `prepared`. Only the key
  that prepared the transfer, under its environment, reaches it at all
  (§7.10).
- **States.** Apply moves a `prepared` transfer to `applying` under the
  registry's lock, so a second apply, or a cancel, while it runs is `409
  transfer_in_progress`. An `applied` transfer is answered as it is, with
  `200`, so a client that lost the response can apply again safely. A
  `preparing` one is `409 transfer_in_progress`, a `cancelled` one `409
  transfer_cancelled`, an `expired` one `409 transfer_expired`, a `stale` one
  `409 stale_preview`.
- **One commit.** Under the write lock, `TransferChangeSet` turns the plan into
  a `ChangeSet` (D107), deciding nothing. Every baseline becomes a
  precondition: each selected collection's record stamp; in `replace`, the
  exact rows; elsewhere each line's row at its `seq`, or absent; a collection
  the guard let change only while empty, still empty; each media line's row;
  each asset here that a written reference resolved to; and the ledger row,
  absent. The writes are the added folders and assets, then per collection the
  schema where the plan writes it, the added and updated entries with their
  usages and search text (extracted against the effective schema), and in
  `replace` a delete for every listed row that is not written; last, the
  ledger row. A precondition that no longer holds is `409 stale_preview`: the
  transfer becomes `stale` and loses its package, and this server is exactly
  as it was.
- **Three checks the commit cannot state**, made under the same write lock
  just before it, which every other write also waits for: the destination's
  project and environment still have the ids the plan recorded, no folder now
  exists at a path the plan adds, and no file at a key it writes. Any is
  `stale_preview`. The first exists because a plan into an environment whose
  selected collections were all absent has only absence preconditions, which
  hold just as well after the environment is deleted, or deleted and made
  again under its name; the schema writes would then recreate the scope with a
  new id. Checking the ids refuses both, and a deleted environment is never
  recreated by an apply.
- **Files outside the transaction.** A blob store cannot join a database
  commit, so the new assets' files go first, each under a key that was free,
  and the keys are saved in `record.json` (`blob_intents`) before the first
  file is written. When the commit does not land, every saved key that no
  catalog row claims is deleted. A file under an existing asset is never
  written.
- **The ledger.** The commit writes `_system/_transfers/<id>`, a new system
  collection: the source, the scopes, the selection, the options, the times
  and the totals. Its absence is a precondition, so a transfer lands at most
  once, and after a crash its presence is what says the commit landed. It is
  instance-local like `_audit` (§7.4): it rides only in `silo export
  --instance`, every other import refuses it, and it is kept without limit.
- **Failures.** A failure that is not a conflict (a refused file, a constraint
  or trigger inside the commit, a lost connection) is settled at once. If the
  ledger row exists the commit landed after all, as Postgres can report a
  dropped connection after `COMMIT`, and the transfer is `applied`. Otherwise
  the files are taken back, the transfer returns to `prepared` with
  `last_error`, and the request answers the failure. If even that cannot be
  learned, the transfer stays `applying` with its keys, and the next apply or
  the next start settles it.
- **Recovery.** `silo serve` settles every `applying` transfer that no apply in
  the process runs, before it listens: with the ledger row, `applied`; without,
  the files taken back and `prepared` again, with `last_error` saying it was
  interrupted, to be applied within its hour.
- **After.** An applied transfer keeps its record, its review and `applied_at`
  for 24 hours (§7.10), and drops its package and plan. The schema cache is
  invalidated. No hooks fire, as for an import (D31).
- **Progress.** With `Accept: application/x-ndjson`, the phases are `media`
  (the files) and `commit`.

**Media (D111)** is planned with the content (§7.11) and shown on the plan's
`_media` and `_media_folders` lines, each with the asset's filename or the
folder's path.

- An asset this server lacks, whose key is free, is `added`: its row as the
  package holds it and its file under the same key, so a pre-D23 `blob:`
  reference to it still resolves.
- An asset this server holds under the same id is never changed. The same
  bytes (sha256 and size) with the same filename, folder, content type and
  tags is `unchanged`. Anything else is `skipped` with the reason, and this
  server's asset is kept: other bytes, other details, or an asset being
  deleted. A transfer does not rename, move, retag or replace an asset; that
  is each library's own work (D67).
- A packaged asset whose key holds a file this server's catalog does not claim
  is `skipped`.
- Folders are matched by path. One this server lacks is `added`, under the
  package's id when that id is free.
- Nothing is deleted, in either mode: `replace` replaces entries, not the
  library.
- With `media: none` no row and no byte ride, and the plan names every
  reference the written entries hold that will not resolve here, in
  `review.media.unresolved` and on each entry line. So does `referenced`, for
  the source's `missing_media` and for a skipped asset this server does not
  hold. The entry API refuses such a reference; a transfer writes it as an
  import does (§7.2), and the review is where it is seen. A pre-D23 `blob:`
  reference names a key rather than an asset and is not judged, as the entry
  API does not judge it.

**Memory.** A commit is one `ChangeSet`, so every entry the plan writes is in
memory at once, bounded by `[transfer]`'s ceilings on the package (D85).

The admin's page for a transfer from another server comes next.
