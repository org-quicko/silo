# Export, import and copy

> The archive format, the on-disk layout, and every way data moves. The design rationale is in [docs/design/transfer.md](../design/transfer.md).

```sh
silo export --dir ./backup               # an on-disk tree
silo export --out backup.tar.gz          # a reproducible tarball
silo import ./backup --mode merge        # newest updated_at wins
silo import backup.tar.gz --mode replace # replace per collection
```

An export holds every project and environment, empty ones included, plus the
schemas, the entries and the media. API key hashes are left out unless you pass
`--with-keys`, so a content export you hand to someone else ships no
credentials. Entries are ordered by collection and by id, so an archive is
byte-for-byte reproducible from identical data.

## On-disk layout

The filesystem driver's layout **is** the export format. That is what makes an
fs-backed instance a live export:

```
<data-dir>/
  manifest.json                 # format_version, instance_id, last_seq
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
- **replace** deletes each collection the archive carries, in that scope only,
  and then loads it. A collection the archive does not carry is left alone.

An imported entry keeps its id, its revision, its timestamps and its scope.
`seq` is reassigned locally, and the importing instance keeps its own
`instance_id`, so cloning data does not clone identity. Validation is off by
default, because the source instance already accepted this data, possibly under
an older schema.

Two limits are worth knowing.

**Deletions do not merge.** silo keeps no tombstones, so only `replace`
reflects a deletion made somewhere else.

**An import is not atomic.** A failure partway leaves the earlier writes in
place. Treat a failed import as unknown state, and check an untrusted archive
with `--dry-run` first.

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
    "dry_run": true
  }'
```

## Copying between environments

Moving data between two environments of one instance needs no archive. Promoting
`dev` to `staging`, or seeding a fresh environment from `prod`, is one request.
`POST /api/projects/{project}/envs/{env}/copy` is destination-driven, like
`/api/copy`: the route names the environment being written, and the body names
the source. It takes the same `mode`, `prefer`, `validate` and `dry_run` options
an import takes, and it runs entirely inside the server.

```sh
curl -X POST http://localhost:8090/api/projects/acme/envs/staging/copy \
  -H "Authorization: Bearer $SILO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from": {"project": "acme", "env": "prod"}, "mode": "merge", "dry_run": true}'
```

```json
{ "mode": "merge", "dry_run": true, "added": 12, "updated": 0, "deleted": 0, "skipped": 3 }
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
the same preview-then-apply flow.

## Format version

Every copy of your data carries a `format_version`: the SQLite `meta` table, an
fs instance's `manifest.json`, and every export manifest. It is `"1"`.

silo refuses to open or import data stamped with a version it does not know,
rather than misreading or corrupting it. The version moves independently of the
binary and of the API version, and only for a breaking change to the layout.
