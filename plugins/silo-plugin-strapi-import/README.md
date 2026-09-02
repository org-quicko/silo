# silo-plugin-strapi-import

Import a **Strapi 5** SQLite export into silo collections, from a screen inside
the silo admin.

Point it at the `.db` a `strapi transfer` produces, and it reads what is in
there, proposes one silo collection per Strapi content type — single types
included, components nested inside the entry — lets you rename and narrow that
plan, and then writes it, with progress per collection.

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
                 GET  /plan          one collection per content type, editable,
                                     with the scopes it could be written into
                 GET  /targets       those scopes on their own
                 POST /imports       run it, in the background
                 GET  /imports/:id   progress
```

1. **Upload the export.** The `.db` is staged on the server, opened read-only,
   and read. Nothing is written to silo yet.
2. **Point it at `public/uploads`.** The export carries the file *catalog* and
   never the files, so the panel asks for the folder and sends the ones the
   import actually references. Skip this and every media field keeps its Strapi
   URL instead.
3. **Plan.** One silo collection per Strapi content type, one entry per document,
   with a JSON Schema derived from the source's own tables — nested, where the
   source nests. Choose the project and environment, rename anything, untick what
   you do not want, and choose per collection what happens if it already has
   entries.
4. **Import.** Runs off the request that started it — 367 entries do not fit in a
   five-second dispatch budget — and the panel polls it.

## Where an import goes

**The plan says, and nothing else does.** The two selects at the top of the plan
are filled from the projects and environments silo actually has (`GET /targets`),
and the plan opens on the first of them.

There is no configured target, and that is a fix rather than an omission. When
`[plugins.config]` also named a `project` and an `env`, they were two answers to
one question: the panel rebuilt its selects on every re-render — after staging the
uploads, on every poll of a running import — and put them back to the configured
scope, so an operator who retargeted a plan and then sent their files watched the
import go somewhere else without being told.

## The mapping, and why

**One silo collection per Strapi content type, one entry per document, with the
components nested inside it.** A single type is a collection holding one entry,
which is what Strapi does with it — a table with a row in it — so the shape you
edit in Strapi is the shape you get in silo.

A component becomes an object, a repeatable one an array of objects, and a
dynamic zone an array whose items carry Strapi's own `__component`. All the way
down: `validation.item` holding a list of `validation.issue`, each holding two
media fields, arrives as exactly that.

**This is the second answer to that question.** The first lifted every repeatable
component into a collection of its own, reasoning that a single type wrapping one
is "a table wearing a single type as a hat" and that one entry holding a
251-element array is one `rev` for the whole table and unsearchable per row. Both
of those are still true. They cost less than the flattening did, measured against
a real 45-content-type export:

| what the source had | what the flattening did |
| :-- | :-- |
| a component holding a component | a collection of the outer rows, with the inner ones nowhere — 988 `validation.issue` rows dropped without a word |
| a component with no columns of its own | a collection with an empty schema and one blank entry per row |
| one component used by two content types | two collections proposing the same name, and a plan that refuses itself |
| a collection type with components | the components split away from the entries that own them |

Fidelity first. An operator who wants a component as its own collection can get
there from an entry; nobody can get the nesting back from a split.

**The name is the content type's, carried whole.** `api::` is dropped and a
segment that only repeats the one before it goes with it, so
`api::article.article` proposes `article` and `api::blog.article` proposes
`blog-article`. That is the name Strapi's own sidebar shows, which is the only
name you can check a plan against. `collection_prefix` prepends to all of them.

**Nothing of Strapi's identity is carried.** No `strapi_id`, no `document_id`.
Silo mints its own id (D2) and nothing on either side resolves a Strapi one, so a
column holding one is a field that looks like a key and is not. A re-import
matches on content or it does not match at all, which is what the plan's
`replace` is for.

### What the export does not say

A content type's schema is in the export. **A component's is not** — it lives in
the project's `src/components/*.json`, which a database export does not carry —
so a component's shape is read from its data: its table's columns are its
scalars, its `_cmps` join table names its children, and `files_related_mph` names
its files.

That leaves one gap, and the content-manager's per-component configuration closes
half of it. That record names every field of every component, so a field that was
declared and never filled still reaches the imported collection — as a property
with **no type**, because naming a field and knowing what goes in it are two
different claims and the export only supports the first. `com-quicko-app-store.connection`
imports with `oauth` typed and `credential` and `api` present and open.

The half that stays open: a nested component's `repeatable` is inferred from
whether any one row holds more than one child, the way a media field's `multiple`
already was. A content type's own fields never need that — its schema says.

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

### Where the files land

`media_folder` names a folder in silo's media library, `strapi` by default, and
the first import **creates it** if it is not there. An asset naming a folder
already implies one, so what the explicit record buys is a folder you can see in
the library tree from the start, and one that outlives every file in it.

Set it to the empty string for the library root. It used to end up there whatever
the configuration said, because silo does not apply a config schema's `default` —
the manifest advertised `strapi` and the plugin read a missing key as "root", so
an operator who never wrote the key got several hundred hashed Strapi filenames in
the root of their library.

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

## The traps it exists to avoid

**Strapi 5 stores a separate copy of every component row per document version.**
A 29-item list is 58 rows in `components_…`, half owned by the draft copy and
half by the published one, with the media attached to both. Reading the component
table directly imports every row twice — and it fails *silently*: no error, no
duplicate id, just twice as much content.

`StrapiVersions` names the entity ids of the version being imported, once, at the
top — and every component row in the tree is reached *from* one of those ids
through a join table. So the draft copies are not filtered out at each depth,
they are never reached, and the trap is closed by shape rather than by a clause
repeated everywhere and eventually fixed in only one place.

**The second trap: a component's table is named from a *pluralised* form of its
uid**, and the mapping lives in the project's `src/components/*.json` rather than
in the export:

| uid | table |
| :-- | :-- |
| `org-quicko.bank` | `components_org_quicko_banks` |
| `org-quicko.payment-entity` | `components_org_quicko_payment_entiti**es**` |
| `org-quicko.states` | `components_org_quicko_states**_s**` |

A prefix match handles the first and third and fails the second; a singularising
match handles the first two and fails the third. So `StrapiComponents` **searches
and then proves**: candidates from four matchers in confidence order, and a
candidate only wins if it contains the rows the join table points at. What cannot
be proved is reported as unresolved rather than guessed — on the plan, beside the
collection whose entries will be missing that field.

**The third trap: a table is not always called what the schema calls it.** Strapi
caps a database identifier at 55 characters and shortens anything longer to its
first 50 plus a five-character digest, while the content-type schema keeps the
long name:

| `collectionName` | the table |
| :-- | :-- |
| `com_quicko_it_file_2026_incomes_bnp_settlements_templates` | `com_quicko_it_file_2026_incomes_bnp_settlements_te**ec0f2**` |

Asking whether `collectionName` is a table therefore reports a content type as
missing from an export that holds every one of its rows. `StrapiIdentifiers`
answers both spellings. The digest is **shake256**, which is the whole reason it
is a file rather than a `slice`: sha256, sha1, md5 and sha3-256 each produce five
entirely plausible characters, and none of them produce Strapi's.

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
| `collection_prefix` | prepended to every proposed name, e.g. `strapi_` |
| `media_base_url` | the Strapi instance still serving `/uploads/…`, used for a file you did not supply. Empty leaves paths relative — a true statement about the source, where a guessed host would be a false one |
| `media_folder` | where supplied uploads land in silo's media library, `strapi` by default, created on the first import. Empty means the root |
| `work_dir` | where the export and the supplied uploads are staged. Defaults under the system temp dir, deliberately **not** the data directory: D5 promises that is only your content |
| `version` | `published` (default) or `draft` |

Nothing here names a target project or environment: that is chosen on the plan,
against the scopes silo actually has. Every default above is applied by
`PluginSettings`, because silo validates `[plugins.config]` without filling a
schema's `default` in.

## Development

No build step and no runtime dependencies on silo — it reaches the host through
the `silo:api` virtual module. It does use `bun:sqlite` and node's `fs`, which is
why its `tsconfig.json` adds `types: ["bun"]`: that is editor support, not a
dependency. A plugin runs inside silo's own Bun worker and holds its privileges
(§13.4).

```sh
bun test plugins/silo-plugin-strapi-import   # from the repo root
bun x tsc --noEmit -p tsconfig.json
```

### Layout

Five subjects, and a one-way dependency direction: `routes/` composes `worker/`,
which owns the state the rest is reached through, and nothing below reaches back
up.

```
src/
├─ index.ts          activate/deactivate, and the four route groups spread onto one object
├─ routes/           one file per group of routes — source, uploads, plan, imports
├─ worker/           the state one worker holds, and the configuration it read
├─ strapi/           reading the export: the database, identifiers, versions, shapes, entries, media
├─ staging/          where the .db and the supplied uploads live while a run needs them
├─ silo/             writing into silo: media, multipart, collection names, target scopes
├─ panel/            the admin panel, one inlined HTML file (the manifest allows one)
└─ types/            silo-api.d.ts, verbatim from the host
test/
├─ support/          the synthetic Strapi database, a temp directory, a fake ctx
└─ *.test.ts         one file per subject
```

The panel stays a single file with its CSS and script inlined, because
`contributes.ui` names **one** HTML file: a directory would mean a static asset
server inside the API, and every part of one is another way for plugin-authored
bytes to be served from silo's own origin.

## Licence

AGPL-3.0-or-later, like silo.
