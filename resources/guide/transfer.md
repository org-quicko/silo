# Export, import and copy

> The archive format, the on-disk layout, and every way data moves. The design rationale is in [resources/design/transfer.md](../design/transfer.md).

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
| `_audit`, `_plugins`, `_transfers` | only by `silo import`, from an archive made with `silo export --instance`. Over HTTP the request is a `403`, for every key |
| `_scope_renames`, any other `_` name | never imported. The request is a `400` |

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
`export` on the old instance and `import` on the new one. Use
`silo export --instance` for it: a plain export leaves the plugin grants and
the audit log behind. The steps are in
[configuration.md](configuration.md#changing-the-storage-driver). This also
serves as the acceptance test for any new storage driver.

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

To copy from an environment on a different instance, see
[Copying an environment from another instance](#copying-an-environment-from-another-instance).

## Copying an environment from another instance

Use this to move content from an environment on one instance to an
environment on a different instance. For example, promote `acme/dev` on the
dev server to `acme/uat` on the uat server, or copy `acme/prod` down to
`acme/uat` to refresh it. The two environment names can be different.

The copy has three steps:

1. **Prepare.** The destination gets a package from the source. The package
   holds only the collections and entries that you select, and the media files
   that those entries use. The destination checks the package and makes a plan
   from it. It writes nothing.
2. **Review.** Read the plan. It shows each entry and each media file that the
   copy adds, updates, skips or deletes.
3. **Apply.** The destination writes the plan as one change. If the
   destination changed after the plan was made, it writes nothing, and the
   transfer becomes `stale`. Prepare it again.

The review and Apply use the saved package. They do not read the source
again, so changes on the source after Prepare do not move the plan.

The source must run silo 1.6.0 or later. The destination must use the SQLite
or the Postgres driver. The fs driver cannot write a plan as one change, so it
refuses with `409 atomic_commit_unsupported`.

### The keys

Make one key on each instance:

```
source        transfer:export
              collections:<project>/<env>/*:schema:read
              collections:<project>/<env>/*:entries:read
destination   transfer:copy
              collections:<project>/<env>/*:create
              collections:<project>/<env>/*:schema:update
              collections:<project>/<env>/*:entries:create
              collections:<project>/<env>/*:entries:update
replace mode  collections:<project>/<env>/*:delete
              collections:<project>/<env>/*:entries:delete
media         media:create, unless media is none
```

Give the source key read claims only. The destination does not keep the source
key. Give it again for each copy.

The plan shows the id of an entry that only the destination holds, as in a
`replace` delete, only to a destination key that can read that collection
(`schema:read` and `entries:read`).

### In the admin

1. Add the source server to the admin's server list one time.
2. Open the destination server, and go to **Settings > Environment > Data
   Transfer** for the destination environment.
3. In **Source server**, select the source.
4. Paste the source key in **Source API key**. The admin does not save it.
5. Select the source project and environment, the mode, and what to copy.
6. Click **Preview copy**. Read the totals and the changes.
7. Click **Apply copy**.

If the page shows **This environment changed since the preview**, click
**Preview again**. When you change an input or leave the page, the admin
cancels the preview.

The browser reads the source to show its projects, collections and entries. Use
a source URL that works from the browser and from the destination server.

### With HTTP

Prepare a transfer:

```sh
curl -X POST https://uat.example.com/api/projects/acme/envs/uat/transfers \
  -H "Authorization: Bearer $UAT_SILO_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {"url": "https://dev.example.com", "api_key": "'"$DEV_SILO_KEY"'"},
    "from": {"project": "acme", "env": "dev"},
    "selection": [{"collection": "posts"}, {"collection": "pages", "entry_ids": ["01J8XQ4Z8K9M2P3R5T7V9X1B3D"]}],
    "mode": "merge",
    "media": "referenced"
  }'
```

The answer is `201` with the transfer. `review` holds the totals, and `entries`
holds the first page of the plan. Then use these routes, with the same key:

| Request | What it does |
|---------|--------------|
| `GET …/transfers/{id}?detail_offset=25` | Reads the next page of the plan |
| `GET …/transfers/{id}/entries/{collection}/{entry}` | Reads the copy of one entry that Apply writes |
| `POST …/transfers/{id}/apply` | Writes the plan as one change |
| `DELETE …/transfers/{id}` | Cancels the transfer |

Send `Accept: application/x-ndjson` to Prepare and to Apply to get progress
lines (see [Watch a long transfer](#watch-a-long-transfer)). The first line has
the transfer id, so you can cancel a transfer while the destination pulls it.

```
{"type":"progress","phase":"fetch","transfer":{"id":"01J9...","state":"preparing","expires_at":"..."}}
{"type":"progress","phase":"verify","transfer":{...}}
{"type":"progress","phase":"plan","transfer":{...}}
{"type":"result","result":{"id":"01J9...","state":"prepared",...}}
```

Apply sends the phases `media` and `commit`.

### The rules

- `selection` must name each collection. An item with `entry_ids` copies only
  those entries, and only in `merge` mode.
- `media` is `referenced` (the default) or `none`. `referenced` copies the
  media files that the selected entries use. `none` copies no media rows and no
  files.
- The copy adds a media asset that the destination does not have. It never
  changes or deletes an asset on the destination, also in `replace` mode. If
  the destination has an asset with the same id but other bytes or details,
  the plan shows it as `skipped`, with the reason.
- The plan lists each media reference that will not resolve on the
  destination.
- Variables and keys do not move. Each instance keeps its own.
- Only the key that prepared a transfer can read, apply or cancel it. Other
  keys get `404`.
- A prepared transfer expires after 60 minutes. A server holds 4 open
  transfers at most. The next one gets `429 too_many_transfers`. Cancel the
  transfers that you do not use.
- Apply asks for the destination claims again. A key that lost a claim gets
  `403`, and the transfer stays prepared.
- Apply on an applied transfer returns the transfer with `200`, and writes
  nothing.
- Each Apply writes one row in `_system/_transfers`. These rows move only with
  `silo export --instance`.
- If the server stops during Apply, `silo serve` completes or removes that
  Apply when it starts again.

### The errors

| Code | Status | What to do |
|------|--------|------------|
| `stale_preview` | `409` | The destination changed after the plan. Prepare again. |
| `transfer_expired` | `409` | The transfer is older than 60 minutes. Prepare again. |
| `transfer_in_progress` | `409` | The transfer is still in Prepare or in Apply. Wait, then read it. |
| `transfer_cancelled` | `409` | The transfer was cancelled. Prepare again. |
| `transfer_applied` | `409` | A cancel of an applied transfer. The copy is already written. |
| `too_many_transfers` | `429` | Cancel a transfer, or wait until one ends. |
| `atomic_commit_unsupported` | `409` | The destination uses the fs driver. Use SQLite or Postgres. |
| `conflict` | `409` | A schema change on a collection that has entries on the destination (D70). |

A refusal from the source, for example a bad key, is a `400` that gives the
source's message.

### Security

The destination sends a request to the URL in `source.url`. silo does not
limit the addresses that it sends to. Thus a key with `transfer:copy` can make
the server send a request to any address that the server can reach, also an
address in your private network. Give `transfer:copy` only to the people who
release content. Use firewall rules to limit the outbound connections of the
server.

## Format version

Every copy of your data carries a `format_version`: the SQLite `meta` table, an
fs instance's `manifest.json`, and every export manifest. It is `"1"`.

silo refuses to open or import data stamped with a version it does not know,
rather than misreading or corrupting it. The version moves independently of the
binary and of the API version, and only for a breaking change to the layout.
