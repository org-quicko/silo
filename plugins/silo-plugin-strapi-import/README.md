# silo-plugin-strapi-import

Import a **Strapi 5** SQLite export into silo collections, from a panel inside
the silo admin.

Point it at the `.db` that `strapi transfer` produces. It reads what is in
there, proposes one silo collection per Strapi content type, lets you rename and
narrow that plan, and then writes it with progress per collection. Single types
are included, and a component is nested inside the entry that owns it.

Media comes across as media. Supply Strapi's `public/uploads` folder and the
files land in silo's own media library, so an entry holds `silo://media/<id>`
instead of a link back to the instance you are leaving.

## How it works

```
   data.db  ──►  POST /source        the export, as bytes
   uploads/ ──►  GET  /files         which files it wants, and which arrived
                 POST /files?name=   one file's bytes, per file
                 GET  /plan          one collection per content type, editable
                 GET  /targets       the projects and environments it can write to
                 POST /imports       run it, in the background
                 GET  /imports/:id   progress
```

1. **Upload the export.** The `.db` is staged on the server, opened read-only,
   and read. Nothing is written to silo yet.
2. **Point it at `public/uploads`.** The export carries the file *catalog* and
   never the files, so the panel asks for the folder and sends the ones the
   import references. Skip this step and each media field keeps its Strapi URL.
3. **Check the plan.** One silo collection per content type, one entry per
   document, with a JSON Schema derived from the source's own tables. Choose the
   project and environment, rename anything, untick what you do not want, and
   choose per collection what happens if it already holds entries.
4. **Import.** The run happens off the request that started it, because 367
   entries do not fit in a five-second dispatch budget. The panel polls it.

**The plan decides where an import goes, and nothing else does.** The two
selects at the top are filled from the projects and environments silo actually
has, and there is no configured target to disagree with them.

## The mapping

**One silo collection per Strapi content type, one entry per document, with the
components nested inside it.** A single type becomes a collection that holds one
entry, which is what Strapi does with it, so the shape you edit in Strapi is the
shape you get in silo.

A component becomes an object, a repeatable component an array of objects, and a
dynamic zone an array whose items carry Strapi's own `__component`. This holds
all the way down.

- **The name is the content type's, carried whole.** `api::` is dropped, and so
  is a segment that only repeats the one before it. `api::article.article`
  proposes `article`, and `api::blog.article` proposes `blog-article`.
  `collection_prefix` prepends to all of them.
- **Nothing of Strapi's identity comes across.** No `strapi_id` and no
  `document_id`. silo mints its own ids, and nothing on either side resolves a
  Strapi one. A re-import matches on content, which is what the plan's `replace`
  mode is for.
- **An enumeration becomes a JSON Schema `enum`,** but only after the rows are
  checked against the declaration. Strapi enforces an enumeration on write and
  never on the rows already stored. A column the data disagrees with imports as
  the string it already was.
- **A single type that is only a wrapper can be flattened,** to one entry per
  component item instead of one entry holding all of them. It is opt-in per step
  on the plan, because fidelity stays the default.
- **Relations are not imported.** A Strapi relation points at another content
  type's `document_id`, and silo's `x-silo-ref` has no integrity enforcement
  yet, so a faithful import would write ids that nothing resolves. Relations are
  reported under the inventory's `skipped`.

## Media

A media field becomes **silo's media type**, which is `x-silo-type: "media"` on
a string, and never a copy of Strapi's media object. With that keyword the admin
draws the picker and a thumbnail, silo counts the reference so a delete is
guarded, and a read rewrites the value against whichever host answered.

The schema is the same whether or not you supplied the bytes:

| you supplied | the entry holds |
| :-- | :-- |
| the file | `silo://media/<id>`, and silo holds the bytes |
| nothing | the absolute Strapi URL, which silo resolves by leaving it alone |
| nothing, and no `media_base_url` | the relative `/uploads/…` path Strapi recorded |

So **import now and send the files later** is a re-import, not a schema
migration.

`media_folder` names a folder in silo’s media library, and the first import
creates it. It is **empty by default**, which is the library root: an import
lands where the library already is unless you say otherwise. `media_layout`
decides the arrangement under it:
`single` puts every upload in that folder, and `by-collection` gives each
collection of the run a folder of its own, with `shared` for a file that two or
more collections reference.

Files are sent one per request, because the 64 MiB body ceiling is a cap on one
request and a real uploads directory is larger than that. Per file it becomes a
cap per file, and progress, retry and resume come with it: `GET /files` says
what is still missing, so an interrupted run resumes by sending the rest.

Several hundred requests back to back is a burst, and a proxy in front of silo
may answer some of them 503 rather than pass them on. The panel retries a file
up to five times with a widening pause, and widens the pause between files as
well for as long as anything is coming back strained, closing it again over a
run of clean sends. A folder that upsets nothing is never slowed. Whatever is
left after that is named in the panel with the status it actually got, and
choosing the folder again sends only what is still missing.

A file is uploaded once per run however many rows point at it, and before it
uploads anything the plugin asks whether silo already holds those exact bytes,
matched on sha256. Strapi's `alternative_text` has nowhere to go, and Strapi's
generated size variants are not imported.

## Install

```sh
silo add ./plugins/silo-plugin-strapi-import
silo plugin doctor
```

Then open **Settings > Plugins > silo-plugin-strapi-import > Open panel**.

To place the directory by hand, add this to your `silo.toml`:

```toml
[[plugins]]
name       = "silo-plugin-strapi-import"
timeout_ms = 20000        # a plan reads a dozen queries; the default 5000 is tight
on_error   = "fail"
claims     = [
  "collections:*/*/*:create",
  "collections:*/*/*:schema:read",
  "collections:*/*/*:entries:create",
  "collections:*/*/*:entries:read",     # optional: counts what is already there
  "collections:*/*/*:entries:delete",   # optional: only for "empty it first"
  "media:create",                       # optional: puts the uploads in the library
  "http:route",
]

  [plugins.config]
  media_base_url = "https://cms.example.com"
  media_folder   = "strapi"        # empty, the default, is the library root
  media_layout   = "by-collection"
```

Three claims are optional, and the manifest says what each one buys. Without
`entries:read` the plan cannot count what is already in a target collection.
Without `entries:delete`, "empty it first" is refused and "add to it" still
works. Without `media:create` each media field keeps its Strapi URL. Recognising an
upload silo already holds, so a re-import does not duplicate it, needs no claim
at all since silo D58 opened the media catalog to reads. Narrow the grant to
the three required claims and you keep a working importer that can only append
and only link.

## Configuration

| Key | |
|-----|--|
| `collection_prefix` | Prepended to every proposed name, for example `strapi_` |
| `media_base_url` | The Strapi instance still serving `/uploads/…`, used for a file you did not supply. Empty leaves the paths relative |
| `media_folder` | Where supplied uploads land in silo’s media library, created on the first import. Empty, the default, is the library root |
| `media_layout` | `single` (default): every upload in `media_folder`. `by-collection`: one folder per collection, plus `shared` |
| `work_dir` | Where the export and the supplied uploads are staged. Defaults under the system temp directory, deliberately not the data directory |
| `version` | `published` (default) or `draft` |

Nothing here names a target project or environment. That is chosen on the plan.
Every default above is applied by the plugin, because silo validates
`[plugins.config]` without filling in a schema's `default`.

## Development

```sh
bun test plugins/silo-plugin-strapi-import   # from the repository root
bun x tsc --noEmit -p plugins/silo-plugin-strapi-import/tsconfig.json
```

No build step, and no runtime dependency on silo: the plugin reaches the host
through the `silo:api` virtual module. It does use `bun:sqlite` and node's `fs`,
which is why its `tsconfig.json` adds `types: ["bun"]`. That is editor support,
not a dependency.

```
src/
├─ index.ts          activate/deactivate, and the four route groups on one object
├─ routes/           one file per group: source, uploads, plan, imports
├─ import/           the plan, and the run
├─ worker/           the state one worker holds, and the configuration it read
├─ strapi/           reading the export: database, identifiers, versions, shapes, entries, media
├─ staging/          where the .db and the uploads live while a run needs them
├─ silo/             writing into silo: media, multipart, collection names, target scopes
├─ panel/            the admin panel, one inlined HTML file
└─ types/            silo-api.d.ts, verbatim from the host
test/
├─ support/          a synthetic Strapi database, a temp directory, a fake ctx
└─ *.test.ts         one file per subject
```

`routes/` composes `worker/`, which owns the state the rest is reached through,
and nothing below reaches back up. The panel stays one file because
`contributes.ui` names one HTML file: a directory would mean a static asset
server inside the API.

The traps this plugin exists to avoid, and the reasoning behind each mapping
choice, are in [docs/design/plugins.md](../../docs/design/plugins.md).

## Licence

AGPL-3.0-or-later, like silo.
