# silo-plugin-strapi-import

Import a **Strapi 5** SQLite export into silo collections, from a screen inside
the silo admin.

Point it at the `.db` a `strapi transfer` produces, and it reads what is in
there, proposes one silo collection per Strapi list, lets you rename and narrow
that plan, and then writes it — with progress, per collection.

silo's first first-party plugin, and the reason three things exist in silo's
plugin system that did not before (D41/§13.20): a route may be handed **bytes**,
a package may contribute an admin **panel**, and a route's declared body cap
joins the manifest digest an operator approves.

Media comes across as media: supply Strapi's `public/uploads` folder and the files
land in silo's own media library, with entries holding `silo://media/<id>` rather
than a link back to the instance you are migrating off.

## What it does

```
   data.db  ──►  POST /source        the export, as bytes
   uploads/ ──►  GET  /files         which files it wants, and which arrived
                 POST /files?name=   one file's bytes, per file
                 GET  /plan          one collection per list, editable
                 POST /imports       run it, in the background
                 GET  /imports/:id   progress
```

1. **Upload the export.** The `.db` is staged on the server, opened read-only,
   and read. Nothing is written to silo yet.
2. **Point it at `public/uploads`.** The export carries the file *catalog* and
   never the files, so the panel asks for the folder and sends the ones the
   import actually references. Skip this and every media field keeps its Strapi
   URL instead.
3. **Plan.** One silo collection per Strapi list, one entry per row, with a JSON
   Schema derived from the source's own columns. Rename anything, untick what you
   do not want, and choose per collection what happens if it already has entries.
4. **Import.** Runs off the request that started it — 367 entries do not fit in a
   five-second dispatch budget — and the panel polls it.

## The mapping, and why

A Strapi single type holding a repeatable component is **a table wearing a single
type as a hat**. So `org-quicko.bank` inside `Org-quicko-bank` becomes an
`org-quicko-bank` collection with one entry per bank, not one entry holding a
29-element array.

That is a modelling decision, not a mechanical translation, and the alternative
is defensible right up to the point of being useful: an array in one entry is
faithful to the source, and it is also one `rev` for the whole table,
unsearchable per row, and not how anyone would model it starting from silo.

**The name is carried whole.** The component's uid and not the single type's, and
with its namespace kept: `org-quicko.bank` proposes `org-quicko-bank`, not `bank`.
Strapi namespaces components because two of them are called the same short word,
and silo's collections are flat, so the short name is the one the *next* import
will also want. `api::` is dropped, and a segment that only repeats the one before
it goes with it, so `api::article.article` still proposes `article`. Rename
anything on the plan; `collection_prefix` prepends to all of them.

**Nothing of Strapi's identity is carried.** No `strapi_id`, no `document_id`.
Silo mints its own id (D2) and nothing on either side resolves a Strapi one, so a
column holding one is a field that looks like a key and is not. A re-import
matches on content or it does not match at all, which is what the plan's `replace`
is for.

## Media

A media field becomes **silo's media type** — `x-silo-type: "media"` on a string
(D23) — and never a copy of Strapi's media object. That is the difference between
importing media and importing something media-shaped: with the keyword, the admin
renders the picker and a thumbnail, `MediaRefs.extract` counts the reference so
deleting the asset is guarded, and a read rewrites the value against whatever host
answered. The earlier version of this plugin emitted
`{ url, name, mime, width, height, size, alt }`, which validated and imported
cleanly while every one of those behaviours passed it by.

What fills the field depends on whether you supplied the bytes, and the schema is
the same either way:

| you supplied | the entry holds |
| :-- | :-- |
| the file | `silo://media/<id>` — silo holds the bytes |
| nothing | the absolute Strapi URL, which silo resolves by leaving alone |
| nothing, and no `media_base_url` | the relative `/uploads/…` path Strapi recorded |

Same `string` either way, so **import now and send the files later** is a
re-import and not a schema migration.

### Why one file per request

`GET /files` lists the uploads this import references — by filename, because
Strapi hashes an upload's name (`Mastercard_0a2d4ecc1c.svg`) and writes it flat,
so the basename of the `url` column and the name in your folder are the same
string. The panel matches your folder against that list and sends only what is
wanted, which is also what keeps the thumbnails and derivatives Strapi generated
out of silo.

The obvious alternative was a zip of `public/uploads` through the same bytes route
the `.db` uses, and it fails on the number that decides it: the 64 MiB body
ceiling is a cap on **one request**, and a real instance's uploads directory is
routinely larger. Per file it caps at 64 MiB *per file* — the unit silo's media
library stores things in — and progress, retry and resume come for free: `/files`
says what is still missing, so an interrupted run resumes by sending the rest.

### Re-importing does not duplicate

A file is uploaded once per run however many rows point at it, and before
uploading anything the plugin asks whether silo already holds those exact bytes —
matched on silo's own **sha256**, not on the filename. Without that, `replace`
would double the media library on every re-run and orphan the previous copies:
`POST /api/media` mints a new id per request and deduplicates nothing.

That lookup needs `media:read`; ungranted, the import still runs and still
uploads, and duplicates on a re-run.

### What does not come across

Strapi's `alternative_text` has nowhere to go — a silo media asset records a
filename, folder, size, content type, hash and tags, and no alt text. And Strapi's
generated size variants (`thumbnail_`, `small_`, `medium_`, `large_`) are not
imported: silo does not model derivatives, and the original is what the catalog
row points at.

## One thing it does not do

**It does not import relations.** A Strapi relation is a row in a link table
pointing at another content type's `document_id`, and silo's `x-silo-ref` has no
integrity enforcement yet (§12.5) — so a faithful import would write ids nothing
resolves. Relations are reported under the inventory's `skipped` and left out.

## The trap it exists to avoid

**Strapi 5 stores a separate copy of every component row per document version.**
A 29-item list is 58 rows in `components_…`, half owned by the draft copy and
half by the published one, with the media attached to both. Reading the component
table directly imports every row twice — and it fails *silently*: no error, no
duplicate id, just twice as much content.

Every count on the plan and every row read goes through `StrapiVersions` and the
join table, filtered by version. That is one function on purpose: two copies of
the clause would be two chances to fix one of them.

The second trap is smaller and just as invisible. Strapi names a component's
table from a *pluralised* form of its uid, and the mapping lives in the project's
`src/components/*.json` rather than in the export:

| uid | table |
| :-- | :-- |
| `org-quicko.bank` | `components_org_quicko_banks` |
| `org-quicko.payment-entity` | `components_org_quicko_payment_entiti**es**` |
| `org-quicko.states` | `components_org_quicko_states**_s**` |

A prefix match handles the first and third and fails the second; a singularising
match handles the first two and fails the third. So `StrapiComponents` **searches
and then proves**: candidates from three matchers in confidence order, and a
candidate only wins if it contains the rows the join table points at. What cannot
be proved is reported as unresolved rather than guessed.

## Install

```sh
cp -r silo-plugin-strapi-import <data dir>/plugins/silo-plugin-strapi-import
```

```toml
[[plugins]]
name       = "silo-plugin-strapi-import"
timeout_ms = 20000        # a plan reads a dozen queries; the default 5000 is tight
on_error   = "fail"
claims     = [
  "collections:*/*/*:create",
  "collections:*/*/*:schema:read",
  "collections:*/*/*:entries:create",
  "collections:*/*/*:entries:read",     # optional — counts what is already there
  "collections:*/*/*:entries:delete",   # optional — only for "empty it first"
  "media:create",                       # optional — puts the uploads in the library
  "media:read",                         # optional — so a re-import does not duplicate
  "http:route",
]

  [plugins.config]
  project        = "default"
  env            = "prod"
  media_base_url = "https://cms.example.com"
  media_folder   = "strapi"
```

```sh
silo plugin doctor
```

Then **Settings → Plugins → silo-plugin-strapi-import → Open panel**.

Four claims are declared `optional`, and the manifest says what each buys.
Without `entries:read` the plan cannot count what is already in a target
collection; without `entries:delete` "empty it first" is refused while "add to it"
still works; without `media:create` every media field keeps its Strapi URL, said
once in the run's report rather than per file; without `media:read` an upload
silo already holds is uploaded again. Narrowing the grant to the three required
claims leaves a working importer that can only append and only link.

## Configuration

| Key | |
|-----|--|
| `project`, `env` | where collections are created; the panel can override per run |
| `collection_prefix` | prepended to every proposed name, e.g. `strapi_` |
| `media_base_url` | the Strapi instance still serving `/uploads/…`, used for a file you did not supply. Empty leaves paths relative — a true statement about the source, where a guessed host would be a false one |
| `media_folder` | where supplied uploads land in silo's media library, `strapi` by default. Empty means the root |
| `work_dir` | where the export and the supplied uploads are staged. Defaults under the system temp dir, deliberately **not** the data directory: D5 promises that is only your content |
| `version` | `published` (default) or `draft` |

## Development

No build step and no runtime dependencies on silo — it reaches the host through
the `silo:api` virtual module. It does use `bun:sqlite` and node's `fs`, which is
why its `tsconfig.json` adds `types: ["bun"]`: that is editor support, not a
dependency. A plugin runs inside silo's own Bun worker and holds its privileges
(§13.4).

```sh
bun x tsc --noEmit -p tsconfig.json
```

## Licence

AGPL-3.0-or-later, like silo.
