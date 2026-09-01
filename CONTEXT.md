# silo — Living Context

> **This is the entry point for anyone — human or AI — touching this repo.**
> It describes what exists *right now*, not what's planned. If your change
> alters behaviour, architecture or the repo layout, update this file **in the
> same change set** — not later. [IMPLEMENTATION.md](IMPLEMENTATION.md) is the
> design spec and rarely changes; this file changes constantly. Don't duplicate
> the spec here — link to it.

## What is silo

A minimal, self-hostable headless CMS. Users define collections with JSON
Schema, get auto-generated forms and a CRUD API, and can move all their data
anywhere via first-class export/import. The differentiator is **portability**:
standard schemas, pluggable storage (SQLite, plain files), and instances that
can be cloned with one command.

## Where things stand

*Last updated: 2026-09-01 (D51)*

Everything through M5 is built and shipping: collections and JSON Schema
validation, entry CRUD with optimistic concurrency, the query AST and search
(D29/D30), the media catalog (D23), projects and environments (D18–D22), API
keys with claims (D12/D21), export/import and scope-to-scope copy, the admin
UI, single-binary releases with Homebrew and RPM, and plugins with an installer
(D31/D32/D33). Plugins now also take byte bodies and contribute admin
panels, and there is a first-party plugin using both to import a Strapi 5 export,
media included (D41). Plugins install *and uninstall* from the API and the admin
(D42/D43), and a plugin's page is a summary with its sections behind sheets so
the plugin's own panel has room (D44). Where the media library keeps its bytes is
configurable from the admin, and still written back to `silo.toml` (D45); so are
where media URLs point and what the library accepts (D46), and the rest of the
config file — logging, search, validation, the auth switch (D47). A media
delete can force past a live reference, singly or in bulk from the admin's
multi-select, and a reference that no longer resolves reads back `null`
instead of a broken link (D48). Force now additionally requires
`entries:update` at every scope it actually reaches, folders can be renamed
or moved (with an opt-in merge past a collision) and deleted recursively, and
the whole library can be purged (D49). The three settings APIs now check that
the file they write can be written, say why when it cannot, and a container
names that file with `SILO_CONFIG` (D50). Projects, environments and
collections are keyed records with ULIDs, so all three can be **renamed** —
from the API and from the admin — and the claims naming them follow (D51).

**The most recent changes all landed on 2026-09-01.**

**A visual-mode save no longer strips the nulls out of an imported
collection.**
`SchemaDraft` was the last reader still comparing `type` as a scalar, and the
only one that also *writes*, which is what made it the damaging one: `kindOf`
read `["integer", "null"]` as no known kind and fell through to `'string'`, and
`build` maps **every** field through `applyKind`, whose default branch assigned
the kind straight back onto `type`. One save of an imported schema from the
visual editor — even one that only edited a description — rewrote every column
to a bare `"string"`, and the collection then rejected the nulls it already
stored. `kindOf` reads through `SchemaType.of` now, as does the reference-list
check beside it, which used to miss a nullable `["array", "null"]` and drop its
`items`. Nullability rides on `SchemaField.nullable` rather than on the spread
of `raw` that `applyKind` overwrites, so the round trip puts
`["integer", "null"]` back, and it survives a *kind change* too: which type a
column holds and whether it may be blank are separate facts, and the rows still
need the second one. The other two shapes `type` can take now have answers of
their own rather than one shared fallback. A property declaring **no** type is
the `any` kind — a real option in the dropdown, written back as no `type` at
all — because that is the honest schema for the `json` column
`StrapiColumns.schemaFor` writes bare, where narrowing to `object` would refuse
the arrays that are just as common. An array form naming anything other than
one real type (`["string", "number"]`, or a lone `["null"]`) is a `construct`
alongside `oneOf`/`anyOf`/`allOf`: the subtree is left intact and the type
column says `type union · edit in Code view`, so no type is thrown away to make
another one drawable. Between them `SchemaType.of`, `isUntyped` and
`isUnresolved` are total over the keyword, which is what leaves no shape needing
a guess.

**A nullable number is still a number: the entries table reads a property's
declared type as the union JSON Schema allows.**
`type` is a string *or an array of them*, and the array form is what imported
content carries — the Strapi importer writes `["integer", "null"]` for every
column, because a field left blank in Strapi is a `NULL`. Three readers in the
entries view compared `type` against `'integer'`, so each was false for exactly
the fields a real import produces. `org-quicko-countries` showed both halves of
that: `numeric_code`'s values right-aligned (`CellValue` reads `typeof value`,
per row) under a left-aligned heading, which reads as two different columns, and
the filter builder offered the column the *string* ops — a `numeric_code` filter
would have sent `"290"` for a field holding `290`, drawing correctly and matching
nothing. `schema/schema-type.ts` is the one place that keyword is read now:
`SchemaType.of` drops `"null"` and answers `null` for a genuine two-type union,
which no cell can render as one thing. `EntriesTable`, `FilterFields.valueType`
and `Columns.isAutoSafe` all read through it, and a numeric column is
right-aligned end to end — heading *label*, values, and the dash an absent value
shows, where the old rule lined the sort icon up with the numbers and left the
dash on the far side of the column. Readers outside the entries view still
compare `type` as a string and are **not** part of this change: the entry form's
`BaseInputTemplate` (a nullable number gets a text input rather than a number
one), `build-ui-schema.ts` and `media-value.ts` (widget selection), `ApiGuide`
(its sample value). `SchemaDraft` was on that list too and is the paragraph
above.

**Search is one UI again.** The rework that moved results into a dropdown
beneath the top-bar search left `views/search/CommandPalette.tsx`, its CSS
Module and `palette-seed.ts` unmounted and unreferenced: `SmartSearch` had
already absorbed everything the `⌘K` overlay did, so all three are deleted
rather than re-mounted and `⌘K` focuses the bar. The `Palette*` names in
`views/search/palette-results.ts` stay — that file is the bar's own result
builder. Two defects in the same rework are fixed with it. Its text was being
sent as `?query=` while §5.5 names the parameter `q`, so a server process older
than the rename saw no text at all — and since a text-less search is a
legitimate filter-only one, it answered with every entry the key could read,
newest first, which made a scope-wide search read as a page of whichever
collection was written last. The wire name is `q` on both sides again; the
admin's call sites still name the field `query`. And the bar now lists the
**collections** it always promised to search, as a leading group matched from
the session's own collection list through the `@`-mention popup's ranker,
capped at five and suppressed while a chip has already narrowed the search to
one collection.

**Projects, environments and collections became ULID-keyed records, so their
names can be renamed (D51).**
A typo in any of the three names used to be permanent: none of them was a keyed
entity, so `entries`, `schemas`, `media_references` and `entry_search` all
repeated the names as literal columns and every rename would have been a cascade
across the instance. All three are now records with a ULID primary key and a
mutable `name`, every internal reference is by id, and a rename is one `UPDATE`
of a `name` column that touches no entry, no index row and no blob. Three
`PATCH` routes take `{name}`, bound to `?expected_id=` and previewable with
`?dry_run=true`, behind a new `RenamePermissions` at the subject's own reach.
`collections` **replaced** the `schemas` table rather than joining it, and its
`schema` is `NOT NULL` — which is why an import carrying content with no schema
beside it is now refused by name, and why `Storage.put` refuses an entry whose
collection has no record. Those rules retire the `listSchemas ∪
listEntryCollections` union in six places. **Claims stay name-based**, so the
one cascade records do not remove is the claim rewrite, and it turns on one
distinction: a literal segment is a reference and is rewritten, a wildcard
segment is a pattern over names and never is — `collections:*/dev/*` means "any
project's dev" and rewriting it would change authority everywhere, so it is
reported as pattern-affected and left alone, in the response, the audit trail
and the admin's confirm dialog. The rewrite is staged behind a
`_scope_renames` marker that doubles as a name reservation and is replayed
before plugins load; `silo.toml`'s `[[plugins]] claims` half is refused rather
than rewritten, on D34's own reasoning. `FormatVersion` resets to `"1"` and
there is **no migration** — export with the previous binary and re-import.
See [D51](IMPLEMENTATION.md) and the six design docs it touches.

**Before that came three fixes and a reorganisation in the Strapi
importer, from one live run (2026-09-01).**
Where an import goes is now the plan's to say and only the plan's: `project` and
`env` left `[plugins.config]`, `SiloTargets` reads the scopes the grant can see,
`GET /plan` answers with those beside the plan, and the panel's selects write into
the plan so a re-render restores the operator's choice instead of overwriting it
with the proposal — which is what used to send a retargeted import to
`default`/`prod` the moment the uploads were staged. `media_folder` now takes
effect: silo validates `[plugins.config]` without applying a schema's `default`,
so the manifest's `strapi` never reached the worker and every import filled the
library root; `PluginSettings` is the one place a default applies, and
`MediaLibrary` declares the folder once per run before the first upload so it is
in the library tree from the start. And the package is a directory per subject —
`src/{routes,worker,strapi,staging,silo,panel,types}` with a `test/` tree beside
it — where it had been twenty files and a 393-line `index.ts` in one directory.
See [`plugins/silo-plugin-strapi-import`](plugins/silo-plugin-strapi-import) and
the [repo map](docs/context/repo-map.md).

**Before it, the settings APIs became honest about the file they
write, and a container gained a way to name it (D50, 2026-09-01).**
A silo deployed to Railway from this repo's Dockerfile answered `500 internal
error` to `PUT /api/media/storage` and `PUT /api/settings/log`, while `GET` on
both said `writable: true`. The config path defaulted to `silo.toml` beside the
process, which in the image is `/app`: owned by root, running as `bun`, so
creating the file was `EACCES` — and the only place that said so was the
server's own log. Three things change. `SILO_CONFIG` names the config file,
below `--config` and above the default, because an image someone else built has
no argv to edit; unlike `--config` it does not make a missing file an error,
since a fresh volume has none and the first save is what creates it. The image
sets it to `/data/silo.toml`, beside the database and the media, both because
`/app` cannot be written and because it is replaced on every deploy.
`ConfigFileAccess` answers "can a save land?" by probing the path — the file's
write access, or the nearest directory that exists when the file does not, since
`ConfigScaffold` creates the rest — so `writable` is about the filesystem rather
than about having been handed a path, and the three views carry a
`read_only_reason` the admin prints instead of asserting the one reason it knew.
And a refusal reaches the caller: `ConfigFileAccess.writing` wraps every table
write, restores the file on any failure, and turns an errno it recognises into a
`400` naming the path and the remedy, while anything with no errno keeps its own
error and its `500`. `TomlTableEdit`'s three refusals became `ValidationError`s
on the same reasoning. The probe stays advisory and the write stays the
guarantee, since permissions change and volumes fill between a `GET` and a `PUT`.

**Before it, what a media force-delete needs was tightened, and folders gained
a rename with an opt-in merge, a recursive delete, and the whole library a
purge (D49, 2026-08-31).**
D48 shipped force gated on `media:delete` alone, an acceptance this
supersedes: force now additionally requires `entries:update`, held at every
scope the assets being force-deleted are actually referenced from — the same
rule `ForcedDeletePermissions` and the transfer/scope-copy replace
permissions already stated three times, that a force must additionally hold
the claims for the effects it cascades into. Unlike those three, media's reach
is **data-derived**: `RouteAuth.requireForcedMediaDelete` (async, unlike its
sibling, because it queries usages) enumerates the *true* referring scopes via
`MediaUsageScopes`, which pages `Storage.listMediaUsages` up to a 2000-row cap
and refuses anyone but a key holding `*` past it — checked against the whole
truth, never the claim-filtered enumeration a refusal's body shows the
caller, since filtering first would let a key force-delete *because* it
cannot see the referrers. The admin mirrors it: `AssetInUseDialog`'s force
checkbox is hidden, not merely disabled, whenever the server would refuse it
(`MediaForceAvailability`). `PATCH /api/media/folders` renames or moves a
folder, its descendant folders and every asset within — no entry touched, no
blob moved, the same D23 property a single asset's rename has always had. It
refuses on collision with `to` unless the caller opts in with `merge: true`;
there is no transaction across the record writes, so the rename is **staged**
the way a deletion is: a `_media_folder_moves` marker is written before the
first record write and cleared after the last, and `resumePending` replays it
at the next start, idempotently, selecting by "still within `from`" so a
half-moved subtree converges rather than doubling. A crash cannot destroy
anything either (folder records write put-then-delete, so a crash leaves a
harmless duplicate rather than a loss — a successful merge leaves none, since
the put is skipped where the destination already has a record). `merge: true`
is now a deliberate operation rather than the repair — it also
legalizes a colliding filename inside the merged folder on purpose, since a
filename is display metadata, never addressing (D23). The admin offers merge
only after a plain rename refuses, gated on `DangerConfirm`'s typed
confirmation rather than a checkbox, because a merge cannot be undone by
renaming back.
`DELETE /api/media/folders?recursive=true` deletes everything inside a
folder through the same saga and per-id outcome machinery `POST
/api/media/delete` already uses, and removes the folder's records only once
every asset in it is confirmed gone; without `recursive` the route is exactly
what it was, except that `force=true` on its own is now a `400` rather than a
silently discarded flag, since without `recursive` nothing in the request
deletes anything. `POST /api/media/purge` (`{confirm: "purge", force?}`)
empties the whole library, paging the catalog in batches rather than loading
it all, checking force's authority once over the whole catalog's id set
before the first delete runs, and answers the same `{deleted, failed}` shape
plus a folder count. The admin
gets rename/delete actions on folder rows and tiles (restructured off a
`<button>` wrapping the whole tile, since rename and delete are buttons of
their own now and cannot nest inside one) through the same two-dialog flow
files use, and a low-emphasis "Purge library" action in the library's page
head, gated on `media:delete`, through `DangerConfirm` with the force opt-in
inside it.

**Before it, D23's flat refusal on a referenced media delete was reversed,
and the read path was given somewhere to put the truth (D48, 2026-08-31).**
`media_in_use` used to be terminal: the only way past it was editing every
referring entry by hand, which does not scale past a handful of references and
is not always possible at all. `MediaDeletionService.delete(id, { force })`
now skips only the usage check — the saga, and the write lock around it, are
otherwise unchanged — reachable as `?force=true` (parsed strictly) on
`DELETE /api/media/{id}` and as the new `POST /api/media/delete`, which takes
`{ids, force}` up to 100 at a time, deletes each sequentially through the same
saga, and **always answers `200`** with a `deleted`/`failed` body rather than a
status code that has nowhere to put the referrers a partial refusal needs
explaining with. No claim was added, and that is an
acceptance rather than a claim that force grants nothing new:
`media:delete` is already instance-global and unscoped, but force does add
reach, since it breaks references in scopes the key cannot read, and the
409's filtered referrer list governs what a caller *learns* rather than
what it may destroy. The exposure is a plugin already holding
`media:delete`, which is not on `PluginForbiddenClaims` and so gains that
reach with no re-approval; a root-only `media:force_delete` is the answer
if it bites. Entries are not rewritten and
their usage rows are not deleted, because those rows are derived state that
`reconcile` re-derives from entries regardless, and no audit action was added,
because entry writes are deliberately outside that trail already. What makes a
force-delete safe to ship is that `MediaLinkResolver` now consults the catalog
for **every** reference in a response, not only in `store` mode, so a media
field whose reference the catalog no longer holds answers `null` instead of a
URL that 404s — one point read per distinct reference, in a bounded loop
capped at 200, never one filtered query over the whole catalog (the fs
adapter has no index by design, §6.3, so a filtered query costs the entire
catalog per response) — costing D46's `EntryUtils.toApiResponse` its zero-I/O
case in `server` mode, though the function itself stays synchronous. The
reference itself is not rewritten, so a client that echoes the resulting
`null` back into a PUT destroys it for real; the admin now omits a `null`
media field from what it submits instead. The admin's
delete flow is one dialog when nothing selected is in use, two when something
is, and never three: a confirm dialog, replaced — only if the server refuses
— by one naming what is still referenced with an opt-in checkbox and a Force
delete button that retries only the still-refused ids.

**Before it, the rest of `silo.toml` became editable from the admin, and the
page started saying what a restart is owed for (D47, 2026-08-31).**
D45 and D46 put two tables behind the API and left four where they were, so an
operator on a managed platform could point silo at a bucket and could not raise
the log level. `GET /api/settings` and `PUT /api/settings/{table}` now cover
`[log]`, `[search]`, `[schema]` and `[auth]` behind a new **`settings:configure`**
claim, with a **Settings → Configuration** page of one card and one Save per
table. It is **spec-driven** where its predecessors are hand-written:
`ConfigSections` states each field once — key, type, the `SILO_*` variable that
beats it, whether it needs a restart, and the label — and the writer, the
override report and the admin's form all read that one statement. The spec
travels in the response, so a setting added on the server appears on the page
with nothing to change there.

**It is also the first that cannot always apply what it saves, and that is the
part worth understanding.** A store can be swapped; a tokenizer rebuilds an index
at boot and a log file is a handle opened once. So `ConfigSupervisor` keeps the
config the process *started on* separate from the file, updates it only where
something genuinely applied, and reports the difference as a restart **owed** —
kept out of `in_force` rather than echoed back into it, which would be worst
exactly where it matters, since `[log] file` is what somebody reads when they are
already lost. `Logger` became mutable in its threshold, format and access-log
switch and stayed immutable in its sinks; `LoggingMiddleware` is always installed
now and asks per request, because an access log you must restart to enable is one
you cannot turn on to watch a problem you are having. Two settings are reported
rather than freely written: **`[storage]` is read-only**, since changing it names
a different instance rather than configuring this one, and **`[auth] disabled`
may be set to `false` and never to `true`**, because an API able to switch off
the authentication protecting it is a lock whose key opens itself. The claim is
root-only and on `PluginForbiddenClaims`: `[schema] allow_remote_refs` alone
turns every schema validation into an outbound fetch of the holder's choosing.
`[[plugins]]` stays out, because it decides what code runs. See §8.4 in
[docs/design/http-api.md](docs/design/http-api.md) and §10.2 in
[docs/design/configuration.md](docs/design/configuration.md).

**Before it, media *delivery* became configurable too, in a table of its own
(D46, 2026-08-31).**
D45 answered where the bytes go. It left two questions that are not about the
driver at all: what URL a client is handed for them, and what may be put in the
library in the first place. Media URLs were rooted at whatever host the request
arrived on, so an instance behind a CDN — or one serving an email CMS, whose
readers cannot authenticate and will not follow silo's cache headers — could not
hand out a stable public link at all; and any file whatever could be uploaded,
because nothing between the multipart parser and the blob store asked what it
was. Both are now `[media]`: `base_url`, `base_url_target`, `extensions`, with
`SILO_MEDIA_*` above them, edited on the same **Settings → Media Library** page
behind the same `media:configure` claim through `GET`/`PUT /api/media/settings`
and its own Save. **Two routes and two Saves, not one**, because they are two
tables with two failure modes: a bad allowlist is a typo, a bad bucket cannot be
opened at all, and one form would make correcting the first depend on the second
still working. `MediaTable` joins `BlobStorageTable` over a shared
`TomlTableEdit`, so both writers keep the one rule — edit as text, parse before
writing, abandon unless the rest of the document reads back identical.

**`base_url_target` is the decision, and it is architectural.** `server` keeps
silo in the read path and addresses an asset by catalog id, which is exactly what
lets `EntryUtils.toApiResponse` stay a pure synchronous function: the URL is
derivable from the reference alone. `store` addresses the **blob key**, because
that is what a bucket serves, and the key lives on the catalog record — so
`MediaLinkResolver` resolves it once per response, before the entries are mapped,
never inside the mapping, and does no I/O at all in the ordinary case. An asset
whose key was not resolved falls back to **silo's own origin** rather than to the
configured base: the CDN has never heard of `/media/<id>`, so a link rooted there
would 404, which is D35's judgement about a base that resolves nowhere. The
allowlist is checked on the **extension** rather than the declared content type,
since a multipart part carries whatever `Content-Type` the client chose and
trusting it lets the caller decide whether the caller is allowed; only the last
extension counts, it runs before any bytes are written, and it runs on rename as
well, or `report.png` becomes `report.exe` afterwards and the check is
decoration. **An instance upgrading with no `[media]` table now gets the default
allowlist** and will refuse types it accepted before. What is deliberately
unchanged is D23: mirroring media folders into S3 was considered and refused,
because S3 has no rename, so a move would become a copy-and-delete of the bytes
and would break every URL already published for that file. Blob keys stay flat
and folders stay catalog metadata, `store` mode included. See §6.5 in
[docs/design/storage.md](docs/design/storage.md) and §8.3 in
[docs/design/http-api.md](docs/design/http-api.md).

**And before that, media storage moved into the admin without making the admin a
second source of truth (D45, 2026-08-31).**
Where the media library keeps its bytes was a `silo.toml` question and only that
— `[blob_storage]`, the `SILO_BLOB_*` variables, or `--blob-path` — which is
fine on a box with a shell and impossible on a managed platform without one.
`GET`/`PUT /api/media/storage` and a **Settings → Media Library** page now expose
it, behind a new `media:configure` claim. **A save still writes the file.**
`BlobStorageTable` replaces the `[blob_storage]` table as text the way
`PluginBlockWriter` edits `[[plugins]]` — parse the result before writing it,
and abandon the write unless the rest of the document reads back identical —
and what then takes effect is **the config re-read the way a start reads it**,
flags and environment back on top, never the posted body. A bucket supplied by
`SILO_BLOB_S3_BUCKET` outranks the file at the next start, so an instance running
on the posted value in between would be reporting a configuration nothing else
agrees with. D42/D43's rule carries over unchanged: the file must never describe
a state the next `serve` cannot reach, so the driver is checked before anything
is written and a configuration that cannot be opened restores the file and
answers 400. The swap itself is one assignment — `ServiceContext.blobStorage`
became a cell behind a getter, `PluginAuthority`'s shape — because every media
call site already read it at the moment it acted.

**The page reads two configurations, and that split is the design.** The form
edits *the file*; `in_force` is what the process is using; `overrides` names
every field the file does not decide, and the variable deciding it where that can
be known exactly. Without it the page would lie twice: the fs media path is
`<data dir>/media` *precisely while nobody has named one*, so a form seeded from
what is in force would save that back as a literal and break `--data`; and an
operator would type a bucket an environment variable was quietly beating. The
secret is write-only — the read carries `secret_access_key_set` and never a
value, an omitted one keeps the file's while `""` clears it, and the merge base
is the file, so a credential held in the environment is never copied into one
that is usually in version control. The field says the same thing: a stored
secret is a mask in a box that takes no keystroke, and clearing it is what opens
the box, so a typed value has to outrank the clear that admitted it. `media:configure` is one claim rather than a
read/write pair, because the read names the bucket, endpoint and access key id;
it is carried by no preset but root and joins `PluginForbiddenClaims`, since a
plugin holding it would receive every future upload in the instance and would get
there by writing the file that decides what code runs. Changes are audited as
`media.configure`. **No bytes are moved** by a switch, which is a property of
object stores rather than something a swap could paper over, and the page says so
beside the provider. See §6.4 in [docs/design/storage.md](docs/design/storage.md)
and §8.2 in [docs/design/http-api.md](docs/design/http-api.md).

**Before that, an install stopped evaporating, and the Strapi importer stopped
proposing everybody's collection names (2026-08-27).**
Installing a plugin into a directory with no `silo.toml` reported `201`, ran the
worker, and warned that nothing would come back at the next start. The file is now
**created**: `ConfigScaffold` owns the annotated default file `silo init` writes,
and `POST /api/plugins/install` and `silo add` write the same one when they have a
plugin to list and no file to list it in. Creating it unasked is safe for one
reason only — the scaffold is silo's *own defaults*, and file values sit below
flags and `SILO_*` env vars, so a fresh file decides nothing the running instance
had not already decided. `silo add` creates it after the claims are confirmed, not
before, because a declined grant must leave the filesystem where it found it. What
is still refused is inventing the path: a process handed no config file at all
keeps the warning, since guessing `./silo.toml` is a file appearing in somebody's
repository. In the same change, the Strapi importer stopped shortening a proposed
collection name to the last segment of its source uid. `org-quicko.bank` proposed
`bank`, which is the collection every *other* Strapi export also wants in an
instance where collections are flat; it now proposes `org-quicko-bank`. Hyphens
came with it, since silo's own id rule (`^[a-z][a-z0-9_-]{0,63}$`) always allowed
them and the plugin was validating against a stricter one of its own. `api::` is
dropped and a segment repeating the one before it goes with it, so
`api::article.article` still proposes `article`. See §13.21 in
[docs/design/plugins.md](docs/design/plugins.md).

**Before that, a plugin became uninstallable without a shell, and the page it is
uninstalled from was rebuilt (D43/D44, 2026-08-27).**
`DELETE /api/plugins/{name}` takes a plugin off an instance whole: its
`[[plugins]]` entry, its worker, its record, its managed key and its package.
Same claim as install (`plugins:enable`), and `If-Match` fenced wherever there is
a record to fence — a package that never got one has no revision to send, and
demanding one would make it unremovable through the API that installed it. **The
order is D42's read backwards**, on the same rule: un-list first and fail hard if
that cannot be done, because a block naming a package that is gone does not fail
that plugin but the whole process; then stop the worker; then forget the record,
which discards the managed key, so a re-installed package comes back approved for
nothing; then delete the files, forgiving a failure. `PluginBlockWriter.remove`
edits the file as text like `append` does and parses the result before writing
it, because a span one table short re-parents a `[plugins.config]` onto the next
plugin. The audit entry outlives the record, since `withdrawn` is the only place
what the plugin could do is written down once the record is gone.

The plugin's page was rebuilt around it (D44). Its four sections — grant, routes,
config, trail — were all open at once, which on a real package is eight claims,
eleven routes, a generated form and an audit trail stacked above the plugin's own
panel, so an operator arriving to *use* one scrolled past all of it. Each is now
a right-hand `Sheet` opened from a button carrying that section's state
(`4 of 8 claims`, `11 routes · 2 public`), which keeps D40's property that the
page answers *is anything waiting on me* unopened. The panel gets the page and a
full-screen mode. Three panel bugs surfaced doing it: the height measurement read
`documentElement.scrollHeight`, which is at least the viewport and therefore the
height the admin had just granted, so a panel could only ever grow and a
collapsed one left a **white** band below it — white because a frame's base
canvas is, and the panel document painted nothing; and the `ResizeObserver` was
never retained, so it was collected and stopped reporting silently. See §13.22 in
[docs/design/plugins.md](docs/design/plugins.md) and §10/§10a in
[docs/design/admin-ui.md](docs/design/admin-ui.md).

**Before that, a plugin became installable without a shell (D42, 2026-08-27).**
`POST /api/plugins/install` acquires a package — npm spec, git URL, HTTPS tarball,
local path, or an uploaded `.tgz` — checks it, starts it, grants it and appends
its `[[plugins]]` block, behind `plugins:enable`. The admin gets an Install
dialog beside "Re-read silo.toml". D34 had reserved this namespace for grants and
lifecycle, on the argument that an API able to write that block is a
code-execution primitive wearing a management claim; the argument was right and
the conclusion had been overtaken, because `rescan` has started arbitrary listed
code on a `plugins:enable` key since D39. That claim *is* the primitive, and
withholding the install only cost an operator on a managed platform a terminal
they do not have. **What is kept is the half worth keeping: the block is written
with `claims = []`.** Effective authority is the file unioned with the record,
and only the record half passes `assertGrantable` and `canDelegate`, is audited,
and can be withdrawn — so a block carrying claims would be a grant no check ever
sees, on this install and on every start after it. The order is the rest of the
design and the first cut had it inverted, running side effects before checks: a
key holding only `plugins:enable` installed a plugin with three claims it could
not delegate and read a 403 while that plugin's route answered 200; a manifest
requiring `keys:create` — which no plugin may ever hold — got it; and a default
install of any package declaring routes or hooks wrote its block and *then*
failed to start, leaving a `silo.toml` the next `serve` refuses to boot on.
`PluginInstallation` now refuses before fetching, refuses before running, starts
ungranted, grants, and writes the block **last**, undoing the package on any
earlier refusal. See §13.21 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that came a media thumbnail resolution fix in the admin entries grid (2026-08-27).**
`CellValue.tsx` rendered media thumbnails using `<img src={asset.url} />` where `asset.url` is
server-relative (`/media/<id>`). When connecting to remote servers or running under the Vite dev server
(port 5173), thumbnails failed to load due to 404s against the admin host. The active server's base URL
is now threaded from `EntriesView` through `EntriesTable` into `CellValue` and prefixed to `asset.url`
consistent with `MediaCard`, `MediaRow`, and `MediaWidget`.

**Before that came silo's first first-party plugin, and the three
things in the plugin system it needed (D41, 2026-08-27).**
[`plugins/silo-plugin-strapi-import`](plugins/silo-plugin-strapi-import) imports
a Strapi 5 SQLite export into silo collections from a screen inside the admin,
and writing it found that two of its three requirements were **impossible**
rather than awkward. A plugin route decoded every body as UTF-8 and capped every
route at one global mebibyte, and `ctx.media` is metadata only — so a plugin
whose job is ingesting a file could not be handed one. A route now declares
`"body": { "kind": "bytes", "max_bytes": n }`, `SiloRequest` gained `bytes`
beside `body` with at most one ever filled, and the number is the author's to
state and silo's to bound at 64 MiB, because it is how much the host allocates
for whoever reaches the route. That made the second gap visible: `http:route` is
**one** claim however many routes exist, so a package could add `"auth":
"public"` to a route in a patch release and publish everything it was granted at
an unauthenticated URL against an approval nobody re-read — `routes` now joins
the `_plugins` record and the manifest digest, which moves a plugin *with* routes
to `needs_review` once. Third, `contributes.ui` is the **iframe contract §12.8
deferred**: a package declares one inlined HTML file, `GET
/api/plugins/{name}/ui` serves it as *JSON* with `nosniff`, and the admin makes
it a document in `sandbox="allow-scripts"` with no `allow-same-origin`. That is
not caution — serving it as a document was measured to be a
credential-exfiltration primitive, since the API shares an origin with the admin
SPA and the SPA keeps an API key per configured server in that origin's
`localStorage`. A panel's one capability is asking the admin to call **its own
plugin's** routes with the operator's key, so the panel spends the operator's
authority and the handler spends the plugin's, and no route needs to be public.
Along the way, **D33's guarantee turned out to have a hole**: "a plugin never
hears about a write it caused" was implemented from the *waiter*, which exists
only while its dispatch is open, so background work that outlived its dispatch
was delivered the plugin's own writes.

The importer's **media** half was then designed twice, and the second time found
something about silo. A Strapi export carries the file *catalog* and never the
uploads, and the first version imported a media field as an object mirroring
Strapi's own — which validated, read back correctly, and was **inert**: silo's
media type is `x-silo-type: "media"` on a *string* (D23) and every behaviour keys
off that keyword, so the admin picker, `MediaRefs`' usage guard and the read-time
URL rewrite all passed it by while nothing failed. A media field is now that
string, holding `silo://media/<id>` where the operator supplied the bytes and the
absolute Strapi URL where they did not — same schema either way, so "import now,
send the files later" is a re-import rather than a migration. The bytes arrive
**one file per request**, because the 64 MiB ceiling caps *one request* and a real
`public/uploads` is routinely larger, so the obvious zip route could not carry the
case it exists for. Two things came out of running it: bytes going *into* silo were
reachable through `ctx` all along (`POST /api/media` is inside `/api/` and takes a
multipart body — only *reading* `/media/{id}` is confined away), and `POST
/api/media` **deduplicates nothing**, so a `replace` re-import doubled the media
library until the plugin started matching silo's own sha256 before uploading.
Whether silo should dedupe on `hash` itself is left open. Nothing of Strapi's
identity is carried now — `strapi_id` and the forced `document_id` are both gone,
because silo mints its own (D2) and nothing on either side resolves a Strapi one.

See §13.20 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that, the admin UI's Appearance settings were reworked
(2026-08-26).** It was fonts and a flat accent-colour grid; it is now a
colour-mode toggle (light/dark/system, the system option resolved live against
`prefers-color-scheme`) plus a grouped theme gallery — Featured, Single
colour, and Vision assistive (colour-blind-safe) — where each entry bundles an
accent with the sidebar tint it was designed alongside, so switching themes
now visibly retints the sidebar rather than only the accent. This is also
silo's first light mode: `tokens.css` gained a `[data-theme='light']` block,
and the handful of CSS Modules that had hardcoded a copy of the default
accent's hex (rather than reading `var(--accent)`) were fixed, since those are
exactly the spots a custom accent or a light background would have exposed.
Landed alongside it: `--text-3`, the dark-mode "muted" text token, was too low
a contrast against `--bg`/`--panel`/`--panel-2` to clear WCAG AA for normal
text (~3.5–4.1:1) and is now `#8890a0` (~5–6:1); light mode's own status
colours (`--ok`/`--warn`/`--bad`) are darkened shades of their dark-mode
values for the same reason — the originals fall under 3:1 against white.
Appearance settings remain client-only, in `localStorage`, never sent to a
server. See §9 in [docs/design/admin-ui.md](docs/design/admin-ui.md).

**Before that, the plugin redesign completed (D36, 2026-08-25).** Two
manifest fields replace two, and the pair is what a grant screen is made of:
`contributes` is **what a package will do** and `permissions` is **what it needs
in order to do it**. `kind` is gone — an enum has one value, so it forced a
package that wanted a background timer to invent a hook merely to be called and
forbade a storage provider from registering the hook that keeps its own derived
data in step. A package now contributes any of hooks, routes, a `runtime`
(`activate(ctx)`/`deactivate(ctx)`) and providers, each provider **naming its own
entry module** because it is imported into the host before storage exists while
the rest of the package runs in a worker afterwards. `activate` costs no claim —
it is reachable by nobody but silo and its `ctx` is the same claim-checked surface
a hook's is — and it runs as a step *after* the app is attached, since at the
moment a worker starts there is nothing for a `ctx` call to dispatch against.
Permissions split into `required` and `optional`, each carrying the author's
`reason`, and **the default grant is `required`** across the CLI, the API and the
grant form: approving everything asked for would make `optional` meaningless.
`required` is stored in the record (D38's rule: the management API never reads
the filesystem) and joins the manifest digest, because promoting an optional claim
changes what a default grant approves without changing a single claim in the list.
The five retired keys refuse the start by name. **D37's F6 is closed** with
`collection.afterDelete` — one event per erased collection carrying the count and
whether the scope above it went too, dispatched outside the write lock, so
auditing and mirroring plugins finally see entries go. A live pass found three
more, and every one was a *report* rather than a behaviour: a failing `activate`
named neither the plugin nor activation, a live narrowing below `required` was
silent though the start warns, and `silo plugin list|info` printed the **record's
raw state** — D40's `/api/plugins` defect exactly, in the other caller of the same
fix. See §13.19 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that came plugin routes (D36, phase 6, 2026-08-25).** A plugin declares routes in its manifest and silo
serves them under `/api/ext/{name}/*` behind a new `http:route` claim. A handler
gets the same `ctx` a hook does, so it acts with **the plugin's** authority and
never the caller's — which is what a plugin route *is*, and which is why
`http:route` is a claim, why `auth: "public"` is declared per route and shown
beside the grant, and why the caller's credential headers are withheld from the
handler. The routes are **data silo matches**, never registrations: one
`app.all("/api/ext/*")` resolved through `PluginSupervisor` per request, so a
plugin cannot shadow or reorder a silo route and phase 4's enable, disable,
revoke and rescan apply to routes exactly as they do to hooks. A plugin reaching
its own route is refused by D33's causal chain rather than by a new counter. See
§13.18 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that, verifying phases 4 and 5 against a running instance found that a
post-commit hook's refusal reached the caller (2026-08-25).** A plugin granted hook delivery but not the claim its `ctx` write needs
made an ordinary entry write answer **403 on a request that had already
succeeded**, quoting a claim the *plugin* lacked to a caller who neither needed
nor lacked it — and the refusal never reached the log, so the operator who had
just narrowed that grant saw nothing while the client saw the wrong thing.
`HookBus.run` asked what class the error was before asking whether the hook was
terminal, so `HookNames.Terminal`'s own rule held for faults and not for
refusals; the fix is the order of the two questions. It dates from D31, but
phase 5 offers the narrowed grant as a checkbox and phase 4 applies it live —
shipping a UI for an operation changes how often its edge cases are reached. See
§13.9 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that came the plugin admin UI (D40, phase 5,
2026-08-25).** `Settings → Plugins` lists what has a record and each plugin's
page is where a grant is approved or narrowed, withdrawn, paused, restarted,
reconfigured and read back — the settings form generated by RJSF from the
manifest's own schema, which D31 carried at 1.0 for exactly this. Phase 4 is
what makes it worth building: before the supervisor every control here would
have ended in "restart the server to find out". **Hook delivery leads the
grant**, because a plugin handed `entry.beforeValidate` rewrites everything
written to a collection and the shorter-looking string is the larger authority.
Rendering it found three shipped defects a reporting surface had been hiding:
the claim summary dropped `hooks:` claims **entirely** (two of them beside one
`entries:read` summarised as "read entries"), `/api/plugins` reported only the
`_plugins` record so a plugin granted through `silo.toml` read as approved for
nothing while it was answering `ctx` calls, and the view carried nothing the
manifest declares. A live pass found a fourth. See §13.17 in
[docs/design/plugins.md](docs/design/plugins.md).

**Before that came the supervisor: plugin authority and lifecycle
change without a restart (D39, phase 4, 2026-08-25).** A `ResolvedGrant`
stopped being *copied* — it was captured on `PluginRuntime`, where `HookBus`
decides delivery, and again inside `PluginContext`, where it becomes the
injected principal — and `PluginAuthority` makes it **one cell with two
readers**, so `set` is the whole of live revocation and nothing is torn down.
That is why the fix is a box rather than a reload engine, and why §13.11's
acceptance test now passes as a file: revoke live, and *both* `ctx` calls and
hook delivery stop, each provable alone. `PluginRegistry` became a mutable
ordered set that only `PluginSupervisor` mutates. Four verbs landed —
`PATCH`/`DELETE /api/plugins/{name}/config` behind `plugins:configure`,
`POST .../restart` and `POST /api/plugins/rescan` behind `plugins:enable` — and
`restart_required` is **deleted**, replaced by a `runtime` block that says
`running | stopped | failed` with the reason. Building it produced one rule that
does not point the same way twice: *the record must never describe a state the
next `serve` cannot reach*, so enabling starts before it writes and disabling
writes before it stops. See §13.16 in
[docs/design/plugins.md](docs/design/plugins.md).

**Before that, `ctx` became the HTTP API (D35, phase 3, 2026-08-25).**
A plugin's `ctx` call is now a request against the same Hono app a network
request hits, carrying a principal the host attaches under a module-private
symbol that nothing arriving over a socket can reach — so `AuthMiddleware` and
`RouteAuth` decide what a plugin may do, and `PluginContext`'s five hand-rolled
claim checks are **deleted rather than widened to forty**. The middleware reads
that principal *before* the `--no-auth` branch, which is D37's fifth finding:
otherwise every plugin on every development instance would have silently held
root. `ctx` is confined to `/api/`, D33's causal chain rides the same slot so a
plugin's HTTP-shaped write still cannot re-enter its own hooks, and a call is
bounded by what is left of its dispatch's budget so a slow route rejects the
*call* instead of killing the worker. The typed client over `ctx.fetch` and the
`silo:api` declarations are both emitted from one `PluginApiContract`. See
§13.15 in [docs/design/plugins.md](docs/design/plugins.md).

**Before that, plugin management got an API and authority changes a
trail (D38, phase 2, 2026-08-25).** `/api/plugins/` stops being a reserved 404:
list, read, grant, revoke, enable and disable, all against the `_plugins` record
and never the filesystem, with `If-Match` required on every mutation — because a
grant means approving *what you read*. A fourth system collection, `_audit`,
records who changed what, written by the services so the offline CLI is in it
too and read through `GET /api/audit` behind a new `audit:read` claim. Keys now
carry `parent_id` and revoking one revokes its descendants, closing D37's fourth
finding. `enabled` is orthogonal to the grant — pausing is not un-approving — and D39
made it take effect immediately. See §13.14 in
[docs/design/plugins.md](docs/design/plugins.md).

**Before that came the route-authority audit (D37, 2026-08-25),** the
gate D35 put on phase 3 — and it changed the shipped API rather than only
describing it. `?force=true` on a collection, environment or project delete now
also requires `entries:delete` at the reach it erases; `DELETE /api/keys/{id}`
is bounded by `canDelegate` against the target's claims, because a key holding
*only* `keys:revoke` could revoke root and lock the instance out; and
`keys:create`, `keys:revoke` and `keys:import` joined the claims a plugin may
never be granted — `keys:import` plants a `_keys` row whose hash the author
chose, which is root with no grant at all. Four findings are recorded and
deferred to the phase that owns each, and two properties phase 3 rests on are
now assertions rather than assumptions. See §13.13 in
[docs/design/plugins.md](docs/design/plugins.md).

**Before that, plugins became granted principals (D34 phase 1,
2026-08-25).** Hook *delivery* is now a claim —
`hooks:<project>/<env>/<collection>:<hook>`, checked before the event crosses
into the worker — closing a hole where a plugin granted nothing could rewrite
every write in the instance. Grants live in a reserved `_plugins` collection,
each approved plugin gets a managed API key whose secret stays host-side, and
`silo plugin grant|revoke` work offline against the data directory.
`silo.toml` still says which plugins load and in what order; the store says what
they may do. **Breaking:** every `[[plugins]]` block now needs a
`hooks:*/*/*:<hook>` claim per declared hook, and the start refuses while naming
them. `/api/ext/` is reserved for plugin routes (D36). See §13.12 in
[docs/design/plugins.md](docs/design/plugins.md).

**Before that, a plugin deadlock was fixed (D33, 2026-08-25).** A hook
that wrote through `ctx` re-entered its own runtime, blocked on the per-plugin
dispatch lock its own caller held, ended at `timeout_ms`, and left the worker
dead with no restart — so the first `ctx` write from a hook was also the last,
and the suite stayed green because the entry landed before the deadlock. Plugin
causality is now a **chain** of the plugins whose hooks are above a write:
`HookBus` skips any plugin already in it, `PluginContext` is stateless, and the
mutex is gone. Nothing about the plugin-facing payload changed. See
[the changelog](docs/context/changelog.md) and §13.5/§13.9 in
[docs/design/plugins.md](docs/design/plugins.md).

**D34–D36 are complete, and so is D37's finding list.** Every phase has landed
and the `contributes` restructure that phase 6 deferred is §13.19, which closed
F6 with it. §13.11 has the shape and the phases.

**The change before that was a repository restructure (2026-08-25).** The tree
moved to a workspace layout — `apps/server`, `apps/admin`, `packages/shared`,
`packages/create-silo-plugin`, `plugins/`, `tools/`, `docs/` — and the code was
decomposed to match: `Service` became `SiloService` plus seven per-subject
services, both storage adapters split per table, the CLI split into flags,
routing and wiring, `ApiClient` became `SiloApi` over per-resource clients, and
the largest UI views were broken into data hooks and components. Behaviour is
unchanged and the full suite passes throughout. See
[the changelog](docs/context/changelog.md) for the entry, and
[the repo map](docs/context/repo-map.md) for where things are now.

## Reading order

| Document | What it answers |
|----------|-----------------|
| [docs/context/architecture.md](docs/context/architecture.md) | How the pieces fit together, in one minute |
| [docs/context/repo-map.md](docs/context/repo-map.md) | Where everything lives |
| [docs/context/code-design.md](docs/context/code-design.md) | How code here is expected to be shaped |
| [docs/context/changelog.md](docs/context/changelog.md) | Every change that altered behaviour, architecture or layout, newest first |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | The vision, the D1–D45 decisions log, and the index into `docs/design/` |
| [README.md](README.md) | How to run, configure and use silo |

## Working in this repo

```bash
bun install
bun test
bun run start                    # the server, from source
bun run --cwd apps/admin dev     # the admin UI against a running server
bun run build                    # the single-file binary
```

Never `git add`, `git commit` or `git push` here — staging and committing are
the author's. Leave the working tree dirty.
