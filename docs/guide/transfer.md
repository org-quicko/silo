# Export, import and copy

> The archive format, the on-disk layout, and every way data moves. The design rationale is in [docs/design/transfer.md](../design/transfer.md).

```sh
silo export --dir ./backup                        # an on-disk tree
silo export --out backup.tar.gz                   # a reproducible tarball
silo export --out posts.tar.gz \
  --include acme/prod/posts                       # one collection
silo import ./backup --mode merge                 # newest updated_at wins
silo import backup.tar.gz --mode replace          # replace per collection
```

An export holds every project and environment, empty ones included, plus the
schemas, the entries and the media. API key hashes are left out unless you pass
`--with-keys`, so a content export you hand to someone else ships no
credentials. Entries are ordered by collection and by id, and every entry is
stamped with the export's own time, so an archive is byte-for-byte reproducible
from identical data.

The archive is written as it is read. The first bytes leave immediately, and no
copy of your data is staged on disk first. This matters behind a reverse proxy:
a response that says nothing for a minute is a response many proxies close.

## Choose what to move

`--include` narrows an export to a project, an environment or a collection. Give
it more than once for more than one rule. Leave it out for the whole instance.

```sh
silo export --out site.tar.gz --include site              # one project
silo export --out prod.tar.gz --include site/prod         # one environment
silo export --out posts.tar.gz \
  --include site/prod/posts --include site/prod/authors    # two collections
```

The HTTP route spells it the same way, one `include` parameter per rule:

```sh
curl -H "Authorization: Bearer $SILO_KEY" \
  "http://localhost:8090/api/export?include=site/prod/posts&include=blog" \
  -o partial.tar.gz
```

`POST /api/import?include=…` uses the same rules to load part of an archive that
holds more. `POST /api/copy` takes them as an `include` array, and sends them on
to the source, so the source builds only what you asked for.

With no rules, an export needs read permission on everything. With rules, it
needs permission only on what the rules name, so a key scoped to one project can
export that project. `--with-keys` always needs instance-wide read, because API
keys are not scoped.

## Media files

`--media` (or `?media=`) says what happens to the files in the media library.

| value | catalog | files |
|-------|---------|-------|
| `all` | every asset | every file in the library |
| `referenced` | only assets the moved entries point at | those files |
| `none` | every asset | none |

The default is `all` for a whole transfer and `referenced` once `--include`
narrows it. A whole export stays complete, and a narrow export does not drag the
whole library with it.

Use `none` when the destination can already read the files, for example when two
instances use the same S3 bucket. The catalog still moves, so filenames, folders
and URLs are kept, and the result reports `0` files written. Loading the catalog
still needs `media:create`.

```sh
curl -X POST "http://new-silo:8090/api/import?mode=merge&media=none" \
  -H "Authorization: Bearer $DESTINATION_SILO_KEY" \
  -H "Content-Type: application/gzip" \
  --data-binary @backup.tar.gz
```

**Replace mode only empties what the archive is complete for.** A whole-instance
archive taken with `media=all` empties the destination library before it loads.
A narrowed archive, or one taken with `media=referenced` or `media=none`, does
not: it adds and replaces what it carries and keeps the rest. The result says
which happened:

```json
{ "mode": "replace", "media": { "files": 12, "cleared": false } }
```

## Watch a long transfer

An import and a copy say nothing between the request and the answer. Behind a
proxy that closes a quiet connection, a transfer that is working can look like
one that has failed.

Send `Accept: application/x-ndjson` to get one JSON object per line instead:

```sh
curl -X POST "http://new-silo:8090/api/import" \
  -H "Authorization: Bearer $DESTINATION_SILO_KEY" \
  -H "Accept: application/x-ndjson" \
  -H "Content-Type: application/gzip" \
  --data-binary @backup.tar.gz
```

```
{"type":"progress","phase":"extract","result":{...}}
{"type":"progress","phase":"entries","result":{"added":200,...}}
{"type":"progress","phase":"media"}
{"type":"result","result":{"added":412,"updated":0,...}}
```

**Read the last line, not the status code.** The status is sent before the work
starts, so it is always `200`. A failure is an `error` line that carries the
status it would have been:

```
{"type":"error","status":409,"error":{"code":"conflict","message":"..."}}
```

A stream that stops with no `result` line means the connection ended before the
transfer finished. The destination is in an unknown state. Check it before you
try again.

The admin UI uses this stream, so its Data Transfer page reports what a long
import or copy is doing while it runs.

If a transfer still runs longer than the connection allows, raise
`[http] idle_timeout` in `silo.toml`. See
[configuration.md](configuration.md).

## On-disk layout

The filesystem driver's layout **is** the export format. That is what makes an
fs-backed instance a live export:

```
<data-dir>/
  manifest.json                 # format_version, instance_id, last_seq,
                                # selection and media, if the export was narrowed
  projects/
    acme/
      prod/
        schemas/
          posts.schema.json
        content/
          posts/
            01J8XQ4Z8K9M2P3R5T7V9X1B3D.json
  media/
```

Each entry file holds the full envelope. silo pretty-prints it with a stable
field order, so a diff stays small. The same collection name in two
environments never collides, on disk or in an archive. SQLite keeps the same
model in `collections` and `entries` tables, keyed by scope.

## Import modes

- **merge**, the default, matches on `(project, environment, collection, id)`.
  An entry missing locally is inserted. An entry present on both sides is
  resolved by the newest `updated_at`, then by the higher `rev`, then by the
  source `instance_id`. Those last two are deterministic tiebreakers.
  `--prefer local|remote` overrides the whole rule.
- **replace** brings each collection the archive carries to the archive's
  content, in that scope only. Every entry in the archive is written over what
  is there. Then every entry the archive does not carry is removed. A collection
  the archive does not carry is left alone.

An imported entry keeps its id, its revision, its timestamps and its scope.
`seq` is reassigned locally, and the importing instance keeps its own
`instance_id`, so cloning data does not clone identity.

**Every entry is validated against the schema it lands under.** There is no
option to turn this off. An entry that does not agree with the schema is not
written. The import continues, and the result counts it as `rejected` and names
it. Read that count after each import. A source instance can hold data that an
older schema accepted, and those rows stop at the door.

```json
{ "added": 120, "updated": 0, "deleted": 0, "skipped": 0, "rejected": 2,
  "rejections": [
    { "project": "acme", "env": "prod", "collection": "posts",
      "id": "01J...", "reason": "validation failed: \"/title\": must be string" }
  ] }
```

The list holds a maximum of 100 entries. The `rejected` count is always
complete. A dry run always reports `rejected: 0`. It does not write the schemas,
so it has nothing to compare the entries against.

**A collection that holds entries keeps its schema.** If the archive carries a
different schema for such a collection, `merge` stops with a `409`. Use
`replace` for that collection, because `replace` deletes the entries before it
writes the schema. You can also delete the entries first. A change to the
access setting, the search fields or the labels is always permitted. Use
`--dry-run` to find this conflict before you import.

Two limits are worth knowing.

**Deletions do not merge.** silo keeps no tombstones, so only `replace`
reflects a deletion made somewhere else.

**An import is not atomic.** A failure partway leaves the earlier writes in
place. Treat a failed import as unknown state, and check an untrusted archive
with `--dry-run` first. A `replace` that stops partway never leaves a collection
empty: it writes first and removes after, so the worst case is extra entries the
archive did not carry. Run the import again to remove them.

## What an import may write into silo's own data

An archive can carry silo's own records under `_system`. A selection cannot
name them, so the import checks them after it unpacks the archive, against the
same claims their own routes ask for:

| Records | Claim needed |
|---------|--------------|
| `_keys` | `keys:import` |
| `_media`, `_media_folders`, `_media_folder_moves` | `media:create`, even with `media=none`; `media:delete` too when `replace` would empty them |
| `_variables` for a project | `create` and `entries:update` on `<project>/*/*` |
| `_audit`, `_plugins`, `_scope_renames`, any other `_` name | never imported. The request is a `400` |

A missing claim is a `403` that names the records and the claim. The check
reads rows, not empty collections, so an export of an empty library loads with
content permissions alone. `silo import` on the host is trusted and loads all
of it.

## Size limits

An archive that arrives over HTTP is checked twice. `[transfer]
max_archive_size_mb` (default 1024) is the most the archive itself may weigh.
`[transfer] max_extracted_size_mb` (default 4096) is the most it may unpack to
on disk, read from the archive's own headers before anything is written, with
every file counted as at least 4 KB. Past either the request is a `413` with
the code `archive_too_large`, and the message names the setting to raise. Both
apply to `/api/import` and to `/api/copy`. A file you name on the command line
is not checked. See [configuration.md](configuration.md).

The archive is unpacked before the import takes the write lock, so a slow
upload holds up nothing else on the instance.

## Cross-driver migration

Export and import speak only the storage interface, so a driver switch is
`export` on the old instance and `import --mode replace` on the new one. This
doubles as the acceptance test for any new storage driver.

## Direct server copy

The admin UI's **Data transfer** view, and `POST /api/copy`, pull an export from
another running silo and feed it to the same importer. Supply the source URL and
a source key holding `transfer:export`, choose merge or replace, and preview
with a dry run before you apply it. The destination uses the source credentials
for that one outbound request and never stores them.

**Data only** keeps the destination's own keys. **Data plus API keys** copies the
key hashes as well, which also needs `keys:export` on the source and
`keys:import` on the destination. In replace mode the copied keys replace the
destination's, so the source key becomes the destination credential.

```sh
curl -X POST http://new-silo:8090/api/copy \
  -H "Authorization: Bearer $DESTINATION_SILO_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source_url": "http://old-silo:8090",
    "source_api_key": "'"$SOURCE_SILO_KEY"'",
    "mode": "merge",
    "with_keys": false,
    "dry_run": true,
    "include": ["site/prod"],
    "media": "referenced"
  }'
```

`include` and `media` work as they do on an export. The destination sends
`include` to the source, so the source reads only what you asked for instead of
building the whole instance and throwing most of it away.

## Copying between environments

An environment copy can be narrowed with an optional `selection` body field:
`[{"collection":"posts"}]` copies that collection and all of its entries;
`[{"collection":"posts","entry_ids":["..."]}]` copies just those entries.
Omit `selection` to retain the original whole-environment copy. Selected
collections always carry their schemas. Entry subsets are merge-only: replace
empties a collection, so a request combining it with `entry_ids` is refused.
Every selected source collection must be readable and every destination
collection writable; the server verifies all names and entry ids before writes.

Moving data between two environments of one instance needs no archive. Promoting
`dev` to `staging`, or seeding a fresh environment from `prod`, is one request.
`POST /api/projects/{project}/envs/{env}/copy` is destination-driven, like
`/api/copy`: the route names the environment being written, and the body names
the source. It takes the same `mode`, `prefer` and `dry_run` options an import
takes, and it runs entirely inside the server.

```sh
curl -X POST http://localhost:8090/api/projects/acme/envs/staging/copy \
  -H "Authorization: Bearer $SILO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from": {"project": "acme", "env": "prod"}, "mode": "merge", "dry_run": true}'
```

```json
{ "mode": "merge", "dry_run": true, "added": 12, "updated": 0, "deleted": 0, "skipped": 3,
  "rejected": 0, "rejections": [] }
```

Unlike the archive routes, this needs **no `transfer:*` claim**. It reaches
nothing the ordinary collection and entry routes reach, so it asks for exactly
those permissions instead:

```
source        collections:<from-project>/<from-env>/*:schema:read
              collections:<from-project>/<from-env>/*:entries:read
destination   collections:<project>/<env>/*:create
              collections:<project>/<env>/*:schema:update
              collections:<project>/<env>/*:entries:create
              collections:<project>/<env>/*:entries:update
replace mode  collections:<project>/<env>/*:delete
              collections:<project>/<env>/*:entries:delete
```

A key scoped to one project, as `collections:acme/*/*:…`, can therefore move
data between that project's environments and no others. Copying an environment
onto itself is a `400`. Media is stored per instance rather than per
environment, so it is already shared and none is copied.

The admin UI exposes this at **Settings > Environment > Data Transfer**, with
the same preview-then-apply flow. Its destination is the environment selected
in the sidebar. **Choose what to copy** opens one source-scope search that adds
collection or entry selections to a compact removable list; it accepts an exact
entry id. Dry-run details paginate
collection schema actions and entry actions, and an entry can be opened there
to inspect its source payload before applying.

## Format version

Every copy of your data carries a `format_version`: the SQLite `meta` table, an
fs instance's `manifest.json`, and every export manifest. It is `"1"`.

silo refuses to open or import data stamped with a version it does not know,
rather than misreading or corrupting it. The version moves independently of the
binary and of the API version, and only for a breaking change to the layout.
