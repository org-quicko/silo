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

## What it does

```
   data.db  ──►  POST /source        the file, as bytes
                 GET  /plan          one collection per list, editable
                 POST /imports       run it, in the background
                 GET  /imports/:id   progress
```

1. **Upload.** The `.db` is staged on the server, opened read-only, and read.
   Nothing is written to silo yet.
2. **Plan.** One silo collection per Strapi list, one entry per row, with a JSON
   Schema derived from the source's own columns. Rename anything, untick what you
   do not want, and choose per collection what happens if it already has entries.
3. **Import.** Runs off the request that started it — 367 entries do not fit in a
   five-second dispatch budget — and the panel polls it.

## The mapping, and why

A Strapi single type holding a repeatable component is **a table wearing a single
type as a hat**. So `org-quicko.bank` inside `Org-quicko-bank` becomes a `bank`
collection with one entry per bank, not one entry holding a 29-element array.

That is a modelling decision, not a mechanical translation, and the alternative
is defensible right up to the point of being useful: an array in one entry is
faithful to the source, and it is also one `rev` for the whole table,
unsearchable per row, and not how anyone would model it starting from silo.

Each entry carries `strapi_id` — the source row's id. Provenance, not identity:
silo mints its own (D2), and a plugin may not set an envelope field.

## Two things it does not do

- **It does not bring media bytes across.** A database export carries the `files`
  *catalog* — names, dimensions, MIME types, `/uploads/…` paths — and never the
  uploads themselves. A media field therefore imports as an object with a `url`,
  absolutised against `media_base_url`. Pulling those into silo's own media
  library is a second job with its own failure modes, and pretending otherwise
  would produce entries pointing at nothing.
- **It does not import relations.** A Strapi relation is a row in a link table
  pointing at another content type's `document_id`, and silo's `x-silo-ref` has
  no integrity enforcement yet (§12.5) — so a faithful import would write ids
  nothing resolves. Relations are reported under the inventory's `skipped` and
  left out.

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
  "http:route",
]

  [plugins.config]
  project        = "default"
  env            = "prod"
  media_base_url = "https://cms.example.com"
```

```sh
silo plugin doctor
```

Then **Settings → Plugins → silo-plugin-strapi-import → Open panel**.

The two `entries:*` claims are declared `optional`, and the manifest says what
each buys: without `entries:read` the plan cannot count what is already in a
target collection, and without `entries:delete` "empty it first" is refused while
"add to it" still works. Narrowing the grant to the three required claims leaves a
working importer that can only append.

## Configuration

| Key | |
|-----|--|
| `project`, `env` | where collections are created; the panel can override per run |
| `collection_prefix` | prepended to every proposed name, e.g. `strapi_` |
| `media_base_url` | the Strapi instance still serving `/uploads/…`. Empty leaves paths relative — a true statement about the source, where a guessed host would be a false one |
| `work_dir` | where an upload is staged. Defaults under the system temp dir, deliberately **not** the data directory: D5 promises that is only your content |
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
