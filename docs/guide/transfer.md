# Export, import and copy

> The archive format, the on-disk layout, and every way data moves. The design rationale is in [docs/design/transfer.md](../design/transfer.md).

```sh
bun run apps/server/src/main.ts export --dir ./backup               # on-disk tree
bun run apps/server/src/main.ts export --out backup.tar.gz          # reproducible tarball
bun run apps/server/src/main.ts import ./backup --mode merge        # newest updated_at wins
bun run apps/server/src/main.ts import backup.tar.gz --mode replace # replace per collection
```

An export contains every project and environment, including empty ones, plus
schemas, entries, and media. API key hashes are excluded unless you pass
`--with-keys`, so a content export handed to someone never ships credentials.
Entries are ordered by collection and id, so an archive is byte-for-byte
reproducible given identical data.

## On-disk layout

The filesystem driver's layout **is** the export format, which is what makes an
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

Each entry file is the full envelope, pretty-printed with a stable field order
so diffs stay small. The same collection name in two environments never collides
on disk or in an archive. SQLite stores the same model in `schemas` and
`entries` tables keyed by `(project, env, collection)`.

## Import modes

- **merge** (default) matches on `(project, environment, collection, id)`.
  Missing locally means insert; present on both sides means newest `updated_at`
  wins, with higher `rev` and then the source `instance_id` as deterministic
  tiebreakers. `--prefer local|remote` overrides this.
- **replace** deletes each collection the archive carries, in that scope only,
  then loads it. Collections absent from the archive are untouched.

Imported entries keep their id, revision, timestamps, and scope. `seq` is
reassigned locally, and the importing instance keeps its own `instance_id`:
cloning data does not clone identity. Validation is off by default, because the
source instance already accepted this data, possibly under an older schema.

Two limits worth knowing. **Deletions do not merge:** v1 has no tombstones, so
only `replace` reflects a deletion made elsewhere. **Imports are not atomic:** a
failure partway leaves earlier writes in place, so treat a failed import as
unknown state and vet untrusted archives with `--dry-run` first.

## Cross-driver migration

Export and import speak only the storage interface, so switching drivers is
`export` on the old instance and `import --mode replace` on the new one. This
doubles as the acceptance test for any new storage driver.

## Direct server copy

The admin UI's **Data transfer** view, and `POST /api/copy`, pull an export from
another running silo and feed it to the same importer. Supply the source URL and
a source key holding `transfer:export`, choose merge or replace, and preview with
a dry run before applying. Source credentials are used for that one outbound
request and are never stored by the destination.

**Data only** preserves the destination's own keys. **Data plus API keys** copies
key hashes as well, which additionally requires `keys:export` on the source and
`keys:import` on the destination; in replace mode the copied keys replace the
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

Moving data between two environments of one instance — promoting `dev` to
`staging`, seeding a fresh environment from `prod` — does not need an archive.
`POST /api/projects/{project}/envs/{env}/copy` is destination-driven like
`/api/copy`: the route names the environment being written and the body names the
source. It takes the same `mode`, `prefer`, `validate` and `dry_run` options an
import does, and runs entirely inside the server.

```sh
curl -X POST http://localhost:8090/api/projects/acme/envs/staging/copy   -H "Authorization: Bearer $SILO_KEY"   -H "Content-Type: application/json"   -d '{"from": {"project": "acme", "env": "prod"}, "mode": "merge", "dry_run": true}'
```

```json
{ "mode": "merge", "dry_run": true, "added": 12, "updated": 0, "deleted": 0, "skipped": 3 }
```

Unlike the archive routes, this needs **no `transfer:*` claim** — it reaches
nothing you could not already reach through the ordinary collection and entry
routes, so it asks for exactly those permissions instead:

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

A key scoped to one project (`collections:acme/*/*:…`) can therefore move data
between that project's environments and no others. Copying an environment onto
itself is a `400`. Media is stored per instance rather than per environment, so
it is shared already and none is copied.

The admin UI exposes this at **Settings → Environment → Data Transfer**, with the
same preview-then-apply flow.

## Format version

Every copy of your data, the SQLite `meta` table, an fs instance's
`manifest.json`, and every export manifest, is stamped with a `format_version`
(currently `"2"`, the project and environment scoped layout). silo refuses to
open or import anything stamped with a version it does not understand, rather
than corrupting or misreading it. The version is bumped for any breaking layout
change, independently of the binary and API version. Pre-1.0 those bumps ship
without migration tooling: re-export with the previous build and re-import, or
start fresh.

