# silo — Living Context

> **This is the entry point for anyone — human or AI — touching this repo.**
> It describes what exists *right now*, not what's planned. If your change alters
> behavior, architecture, or the repo layout, update this file **in the same
> change set** — not later. [IMPLEMENTATION.md](IMPLEMENTATION.md) is the design
> spec and rarely changes; this file changes constantly. Don't duplicate the spec
> here — link to it.

## What is silo

A minimal, self-hostable headless CMS. Users define collections with JSON Schema, get auto-generated forms and a CRUD API, and can move all their data anywhere via first-class export/import. The differentiator is **portability**: standard schemas, pluggable storage (SQLite, plain files), and instances that can be cloned with one command.

## Where things stand

*Last updated: 2026-08-20*

- **Top bar session pill now states scope access, not the key's name
  (2026-08-20):** the pill read `key label · server name`
  (`${sessionInfo?.label || Claims.label(claims)} · ${server.name}`), and both
  halves were already on screen — the server name is the sidebar's scope
  switcher heading, and a key's label is chosen by whoever minted it, so it
  tends to echo the server it was made for (`read · silo-read`). Neither half
  changed as the user moved around, so the pill cost topbar width to repeat the
  sidebar.

  It now shows what the current key can actually do **in the scope on screen**:
  *Full access* / *Read & write* / *Read-only* / *No access*.

  - **Why this and not the label.** The level is *derived*, so unlike a label it
    changes with the route: one key scoped to `default/prod` reads `Read-only`
    there and `No access` in `default/dev`. It is also the only chrome that
    answers "why is there no New entry button here?" — the claims that hide an
    action and the pill now come from the same place.
  - `Claims.accessLevel(claims, project?, env?)`
    (`shared/src/claims/claims.ts`) returns the `AccessLevel` band
    (`shared/src/claims/access-level.ts`). Bands are widest-first: **any** write
    permission anywhere in the scope — entries, collection create/delete, schema
    or access update — makes it `write`, because a pill claiming read-only
    beside a live create button is the more misleading of the two errors.
    Omitting the scope asks the same question instance-wide, which is what
    settings needs when no scope has resolved. `shared/test/claims.test.ts`
    pins the bands, including that non-collection claims (`media:*`, `keys:*`,
    `transfer:*`) grant no scope access on their own.
  - **The key's identity moved to the tooltip** — `buildSessionBadge`
    (`ui/src/views/shell/build-session-badge.ts`) puts label, prefix and scope
    in `SessionBadge.detail`, with the full record still at Settings →
    Connection. `TopBar`'s `session` prop is a `SessionBadge`
    (`ui/src/views/shell/session-badge.ts`) rather than a string, so the 14
    views that forward it are typed rather than formatting their own.
  - Only the dot is tinted (`--session-tone`): accent for root, `--ok` for
    write, `--text-3` for read-only, `--bad` for none. This is a standing fact
    about the session, not an alert, so the label stays `--text-2`.
  - Fixed alongside: the stored key prefix already ends in an ellipsis
    (`KeyFormat.displayPrefix`), so the Connection page's `${keyPrefix}…`
    rendered `silo_uTNaCEf……`.

- **Consolidated server/scope switcher & modal Server Browser (2026-08-20):**
  - Removed redundant ways to navigate back to the servers view (topbar Globe "Servers" button, topbar Lock icon button, and settings nav Globe icon).
  - The left sidebar below the Silo logo/version is now the single scope switcher (`silo-server-name \n project · env`), displaying up/down chevrons (`ChevronsUpDown`).
  - Clicking this switcher opens the 3-column `ServerManager` component in a modal dialog on the same page with the active server, project, and environment pre-selected and highlighted, making switching fast and seamless without leaving the workspace.
  - The Silo brand logo in the sidebar links directly to the current workspace collections view (`Routes.collections(serverId, scope.project, scope.env)`).
  - `ServerManager` supports modal mode when `onClose` is provided, with a backdrop overlay, header close button ('×'), click-outside dismissal, and Escape-key listener.

- **Settings split by scope, and env→env data transfer (2026-08-20):** settings
  was one flat, unscoped list (`/servers/:id/settings/:section`) covering
  General, Projects, Environments, API Keys, Data Transfer and Connection &
  Status. That predated D18–D20: a collection is identified by
  `(project, env, collection)`, so most of what settings configures belongs to a
  particular project or environment, not to the server. It is now three nav
  groups with scope nested inside them, and every page lives at a URL that says
  which scope it configures.

  ```
  SERVER
    API Keys                                       /servers/:sid/settings/keys  (+ /keys/new)
    Data Transfer                                  /servers/:sid/settings/transfer
    Connection                                     /servers/:sid/settings/connection
  PROJECTS
    Projects                                       /servers/:sid/settings/projects
      [ project switcher ▾ · New project ]
      General                                      /servers/:sid/projects/:p/settings/general
      Environments                                 /servers/:sid/projects/:p/settings/environments
        [ environment switcher ▾ · New environment ]
        General                                    /servers/:sid/projects/:p/environments/:e/settings/general
        Data Transfer                              /servers/:sid/projects/:p/environments/:e/settings/transfer
  APPLICATION
    Appearance                                     /servers/:sid/settings/appearance
  ```

  - **Ordered outside-in, and nested the way the data is.** The server hosts
    everything, so it comes first; then the projects it holds; then this
    browser. One project's pages hang off the project index and one
    environment's off that project's environment list — neither is a peer of
    the list it belongs to, because neither exists outside it.
  - **Both nested blocks start collapsed** and open when the route enters them,
    so the nav reads as seven rows until you are actually working inside a
    scope. A parent row's disclosure control is a **sibling** of its link, not a
    child: nesting a button inside an anchor is invalid, and expanding a parent
    must not navigate to it. Navigating out leaves a block as the user left it —
    collapsing under the cursor would be its own surprise.
  - **The way out of settings returns to the scope you were in.** The nav header
    is a back control to that scope's workspace
    (`Routes.collections(serverId, project, env)`), with the gate demoted to a
    small icon button beside it. Before, the only exit was the gate, so leaving
    settings meant re-picking the project and environment you were already
    working in. `Workspace` redirects a bare collections URL to the scope's
    first collection, so the button lands on real content rather than an index.
    With no scope resolved — a server holding no project — the control falls
    back to the gate and says so. Ancestor breadcrumbs are links too, so a page
    two levels deep has a one-click way up as well as out.
  - **An index row is the link to that item's own page.** Projects and
    Environments are indexes, not control panels: a row opens that project's or
    environment's settings, and **delete lives only on the single-item page**,
    where the danger zone can say what is about to be lost and gate it on typing
    the id. A delete button in a list is one stray click from taking a whole
    project's environments with it.

  - **The scope prefix is the workspace routes' prefix, with `settings` as the
    tail** — identical to the HTTP API's
    `/api/projects/{project}/environments/{env}/…` — so a workspace URL becomes
    its settings URL by swapping that tail, and switching context swaps one path
    segment. Server-level pages deliberately take **no** scope prefix: a key or
    a connection belongs to the instance, and prefixing them would let one page
    be bookmarked at as many URLs as there are scopes.
  - **The nested rows still need a scope to point at** while an unscoped page is
    open, so the nav's shape does not change under the cursor as you move
    between scoped and unscoped pages.
    `useSettingsScope` (`ui/src/views/settings/use-settings-scope.ts`) resolves
    one from the route, else the remembered scope, else the server's first
    project and env. `ScopeMemory` (`ui/src/utils/scope-memory.ts`) persists it
    per server in `localStorage` (`silo_active_scope`); `Workspace` writes it,
    since that is where a scope is known for certain.
    - `ScopeMemory.pick` checks the remembered id against what the server still
      lists, deferring while the list loads. Without that, deleting the
      environment you were last in left the switcher displaying it and linking
      to pages that 404 — which is exactly what happened before the check went
      in. `ui/src/utils/scope-memory.test.ts` pins it.
  - **Scope-bound pages are keyed on their scope** in `SettingsView`. Without
    the key, switching environment on the Data Transfer page kept the previous
    environment's copy result on screen and re-labelled it with the new
    environment's name — reporting a copy that never happened.
  - **`Routes.parse` grew three settings views** (`server-settings`,
    `project-settings`, `env-settings`) and `Routes.legacy` rewrites the old
    URLs (`settings/general` → `settings/appearance`; `settings/environments`
    and `settings/envs` → the project-scoped environment list; a bare
    `settings` → the project index; `/status` → `settings/connection`), running
    in `App` before `parse`, which knows nothing about the aliases. `ui/src/router/routes.test.ts` pins the grammar,
    round-trips every builder, and asserts no alias target is itself an alias —
    the loop that would otherwise be a redirect cycle.
    - `ServerRoute` had to stop being `Extract<Route, {project, env}>`:
      `env-settings` has both fields and would have been silently pulled into
      the union `Workspace` consumes. It lists its five views explicitly now.
  - **Deleting a project or an environment is gated on typing the id back**
    (`ui/src/components/DangerConfirm.tsx`, built on the existing `Modal`
    primitives). Forgetting a saved *server* is not — it destroys nothing on the
    instance — and keeps a plain confirmation.
  - **Project deletion moved into Project → General**, and the project index
    stayed a real page at `/servers/:sid/settings/projects` — it is what the
    project block nests under. Server → General is gone, though:
    it held the appearance settings, which are `localStorage` and browser-wide,
    so they became their own APPLICATION group, and Connection already reports
    the version, key and claims a server-info page would have.
  - **Two long-standing scope bugs fell out of having a scope in the route.**
    `NewKeyView` was mounted with `scope={{project: 'default', env: 'prod'}}`
    hardcoded and `collections={[]}`, so its collection chooser was always empty
    and its claims always named the wrong scope; `ExportImportView` got
    `collectionCount={0}` and a no-op `onImported`. Both now receive the
    resolved scope and its real collection list.
  - **`StatTile`/`StatRow` (`ui/src/components/`) replace three identical local
    copies** of the same result-count tile — `ExportImport`'s `StatTile`,
    `CopyServer`'s `CopyStat`, and the one the new transfer page needed. Their
    CSS moved out of `Transfer.module.css` with them. The nav CSS moved from
    `SettingsView.module.css` to `SettingsNav.module.css`, and that file's
    hand-rolled modal and project-tab rules are deleted, since the pages use the
    shared `Modal` primitives now.
  - `ui/src/**/*.test.ts` are their own TypeScript project
    (`ui/tsconfig.test.json`), because they need both DOM and Bun types: the app
    project must not see Bun globals and the repo-root project must not see DOM
    globals. They run under the same root `bun test` as the server suites.

- **Environment-to-environment copy, no archive (2026-08-20, D22):** promoting
  `dev` to `staging` needed a whole-instance archive round trip, and — because
  D21 requires instance-wide authority for `transfer:*` — a key with rights over
  every other tenant to do it. `POST /api/projects/{project}/environments/{env}/copy`
  copies one scope of an instance onto another, destination-driven like
  `/api/copy`: the route names the destination, the body names the source
  (`{from: {project, env}}`) with the same `mode`/`prefer`/`validate`/`dry_run`
  options an import takes. Both `/environments` and `/envs` are registered from
  one handler.
  - **It owns no merge logic.** `Importer.executeImport` already accepted
    `{manifest, scopes}` in memory rather than a directory, so `ScopeCopier`
    (`server/core/transfer/scope-copier.ts`) only reads the source scope out of
    `Storage` into the same `ScopedImport` shape `ImportWalker` builds from an
    archive, re-enveloping each entry onto the destination — the same rule D18
    gives an archive, where the address is authoritative and the entry's own
    `project`/`env` are overwritten. Merge/replace/prefer/dry-run therefore have
    one implementation and copy cannot drift from import. `ParsedImport` is
    exported for it; `Service.copyScope` wraps it in the write mutex like
    `importDir`.
  - **No `transfer:*` claim is required, and that is the point.** A scoped copy
    reaches nothing the caller could not already reach by listing the source
    through the entry API and writing the destination through it, so the guard
    asks for exactly the permissions that loop would need:
    `Claims.ScopeCopyReadPermissions` at the source,
    `ScopeCopyWritePermissions` at the destination, and
    `ScopeCopyReplacePermissions` there in `replace` mode — all via the new
    `Claims.hasScopeWide` / `RouteAuth.requireScopeWide`, the scoped
    counterparts of `hasInstanceWide` / `requireInstanceWide`. A key confined to
    one project can move data between that project's environments and no others.
    Requiring a fixed claim on top would reintroduce the coupling D21 exists to
    prevent.
  - Copying a scope onto itself, or naming `Scope.System` on either side, is a
    `400`. `_`-prefixed collections (`_keys`) are never carried. Media is
    instance-global and unscoped, so a scope copy moves none — the UI says so.
  - Because both sides share an `instance_id`, the importer's last-resort
    tiebreak (`manifest.instance_id > local`) is false, so an entry identical in
    `updated_at` and `rev` is `skipped`. That is the right answer: nothing
    distinguishes the two copies.
  - `server/test/http/scope-copy.test.ts` covers merge/replace/prefer, dry-run
    writing nothing, the self-copy and malformed-source `400`s, a
    project-scoped key succeeding within its project and 403-ing outside it,
    replace without delete authority, `_keys` never travelling, and the `/envs`
    spelling authorizing identically.

- **Expandable sidebar and in-memory collections search (2026-08-20):** the
  sidebar in the connected workspace shell (`ui/src/views/shell/Sidebar.tsx`) is
  now user-resizable and provides in-memory search filtering for collections.
  - **Expandable / Resizable Sidebar:** A drag handle along the right edge of
    the sidebar allows smooth click-and-drag horizontal resizing between 190px
    and 500px (default 248px), preventing text selection and displaying a resize
    cursor while dragging. The chosen width is persisted to `localStorage`
    (`silo_sidebar_width`). Double-clicking the resizer handle resets the width
    to the 248px default. Long collection names use ellipsis truncation with
    tooltips.
  - **In-Memory Collections Search:** A search input field under the Collections
    group header allows filtering collection names in real-time. Features
    an instant clear button, Escape-key clearing, and a dedicated empty state
    when no collections match the query.

- **Entries could only be saved once — `rev` is now in the API response
  (2026-08-20):** `PUT`/`DELETE` on an entry require the expected revision as
  `If-Match`/`?rev=` (§8), but `EntryUtils.toApiResponse` returned only
  `id`, the user fields, and the timestamps — no client could ever learn a
  revision. `EntryMapper` filled the gap with `rev ?? 1`, which is right
  exactly once: the first edit of an entry succeeded, bumped the stored rev to
  2, and every later save 409'd with `rev mismatch: expected 1, current is 2`.
  The admin UI could not update the same entry twice.
  - `toApiResponse` now emits `rev` beside `id`, and deletes a user field of
    that name from the data first, so the envelope value can't be shadowed —
    the same treatment `id` already had. `collection`, `seq`, and the scope
    stay hidden; those are internal and no client is asked for them back.
  - Re-fetching the entry before each save was the alternative and is worse:
    blindly adopting the current revision is precisely the lost-update the
    `If-Match` rule exists to prevent.
  - `server/test/http/entries-api.test.ts` pins the new shape: a list item
    carries `rev` (and still no `seq`/`project`/`env`), two consecutive
    updates using each returned rev both succeed while a stale rev still
    `409`s, and a collection with a user field named `rev` reports the
    envelope revision. 159 tests pass across 17 files.
  - IMPLEMENTATION.md §5.1 said the response hides `rev` "exactly like
    `collection`/`seq`" and README documented `If-Match` without saying where
    a revision comes from; both now describe the response as it behaves.

- **Expand/collapse all on an array field (2026-08-20):** the array header
  carries a toggle whenever it holds more than one collapsible item. Items
  report their open state up through `ArrayItemsContext` and the header names
  the action that would actually change something ("Expand all" unless every
  item is already open) rather than guessing from its own last click. The
  instruction travels back down the same context as `{open, nonce}`; the nonce
  is what makes a second "Collapse all" reach an item the user reopened in
  between. A nested array only ever answers its own toggle, since each
  `ArrayFieldTemplate` provides the context its own items read.

- **Reference-list items are collapsible (2026-08-20):** an array of `$ref`
  items rendered every item's fields inline, so a five-question FAQ list was
  five stacked forms, each headed by RJSF's `faqs-1`/`faqs-2` — a label that
  repeats the array's name and a position and says nothing about the item.
  Array items whose schema is composite (an object, or an unresolved-ref
  marker) now render as a collapsed card: a header row with a disclosure
  chevron, the position as mono metadata, the item's own title, and the
  move/copy/remove actions, with the fields in a collapsible body. Scalar
  items (media arrays, enums) keep the flat row layout — there is nothing to
  summarize. UI-only: no schema, API, or server change.
  - **The title is the item's first filled field.** `ValueTitle`
    (`ui/src/utils/value-title.ts`) walks the value's fields in render
    order — `ui:order`, else `x-silo-ui.order`, else the schema's property
    order, falling back to the value's own keys when the schema declares none
    (an unresolved-ref marker carries no `properties`) — and takes the first
    non-blank scalar, truncated at 90 characters. Nested objects and arrays
    are skipped rather than stringified into the header. It lives under
    `utils/` rather than `forms/` because the entries table needs the same
    rule (below), and that table is not a form.
  - **RJSF hands item data to the item's `SchemaField`, never to
    `ArrayFieldItemTemplate`**, which is exactly where the header needs it, so
    `ArrayFieldTemplate` publishes the live array through `ArrayItemsContext`
    and each item reads its own slice by `index`. The title tracks typing in
    the first field rather than only the loaded value.
  - **An item with no title opens; a titled one starts collapsed.** Nothing to
    show in the header means the user still has to fill it in — a just-added
    item — and RJSF exposes no "this item was added just now" signal, so the
    same answer is derived from the data.
  - **The duplicate label is suppressed at its source.**
    `ArrayItemHeaderContext` carries the id of the field an item header already
    names; `ObjectFieldTemplate` (object items) and `JsonField` (raw-JSON
    items, which render their own label row rather than going through
    `FieldTemplate`) skip their label when it matches. Objects nested deeper
    inside the item still get their group label.
  - **Errors inside a collapsed item surface on its header.** The body is
    hidden with the `hidden` attribute rather than unmounted, so the error is
    still in the DOM and
    `.item:not(.open):has(:global(.field-error))` lights a marker in the
    header. `.body[hidden]` needs an explicit `display: none`, because the
    module's own `display: flex` otherwise beats the UA's `[hidden]` rule.
  - `ArrayFieldTemplate`'s `<fieldset>` gained `min-inline-size: 0`: a
    fieldset's UA `min-content` floor plus a one-line header title meant the
    array refused to narrow below its widest untruncated title and pushed the
    form into horizontal overflow on a narrow viewport.
  - `ObjectFieldTemplate` detected the root object with `props.idSchema?.$id`,
    a v5 prop name that is always `undefined` under RJSF v6 — so the root was
    rendering the group label the check exists to suppress. It reads
    `fieldPathId.$id` now.
  - **The entries table showed `[object Object]`.** `CellValue` rendered array
    elements with `String(v)`, so a reference-list column was a row of
    `[object Object]` chips. Chips (and a plain object cell, which showed a
    bare `{…}`) are now labelled with the same `ValueTitle` rule the form
    headers use, capped at `24ch` with the full text on `title`; a value with
    no scalar to show still falls back to `{…}`.
  157 tests still pass (no server surface changed).

- **Array of reference types in schema (2026-08-19):** a schema property can
  now be `type: array, items: { $ref: "silo://collections/<name>" }` end to
  end, not just a single-item `$ref`. Server-side this already worked — AJV
  follows `$ref` inside `items`, `SchemaBundler.collectRefs` walks `items`,
  and `Service.findSchemaReferrers` already matched array-items refs for the
  delete-conflict check — so no server domain/service/bundler change was
  needed. Three UI gaps were fixed:
  - **Visual schema editor:** a new `ref-array` field kind ("Reference list"
    in the Type dropdown) emits `type: array, items: { $ref }`, round-trips
    through `propToField`/`fieldToProp`, and reuses `RefTarget` (with an
    `isArray` flag so the hint reads "Each array item must match the
    collection's schema"). `SchemaEditor.tsx` is the only place the kind
    list lives.
  - **Entry form rendering:** `buildUiSchema` mis-routed arrays whose
    `items` is a `$ref` into the tags widget (the condition `!p.items?.type`
    matched `{ $ref }`), so the entry form showed a chip input instead of
    nested object fields. Arrays with `items.$ref` (or an
    `x-silo-unresolved-ref` marker on `items`) now fall through to RJSF's
    stock `ArrayField`, which renders each item through the referenced
    collection's schema after `SiloRefs.resolveForForm` has rewritten
    `items.$ref` to an internal `#/$defs/...` pointer. The resolved-item
    branch recurses into the target so widget selection applies inside
    referenced collections too; the marker branch routes each item to the
    raw-JSON fallback field. The tags branch gained a `!p.items?.$ref`
    guard so a `{ $ref }` items never silently matches it.
  - **Field constraint hint:** `FieldTemplate.constraintHint` now reports
    `array<reference>` when `items` carries a `$ref` or the unresolved-ref
    marker, instead of the bare `array` it produced before.
  - **Array templates:** the slate RJSF theme now supplies array-specific
    templates (`ArrayFieldTemplate`, `ArrayFieldItemTemplate`,
    `ArrayFieldItemButtonsTemplate`, `ArrayFieldTitleTemplate`,
    `ArrayFieldDescriptionTemplate`) and a slate `ButtonTemplates` set
    (`AddButton`, `MoveUpButton`, `MoveDownButton`, `CopyButton`,
    `RemoveButton`) built from the shared `Button` component and Lucide
    icons. Previously, reference-list arrays fell back to RJSF's default
    Bootstrap templates, so the add button and item toolboxes rendered with
    `btn btn-info`, `glyphicon`, and `col-xs-*` classes that do not exist in
    the Slate CSS, breaking the form visually. Each array item is now a
    card with the object fields on the left and move/copy/remove actions
    on the right; the add action is a full-width dashed button. These
    templates live under `ui/src/forms/templates/` and are wired into the
    theme in `ui/src/forms/theme.ts`.
  Tests: `server/test/core/schema-refs.test.ts` gained three cases pinning
  array-of-refs validation, bundling (items `$ref` preserved + `$defs`
  populated), and the delete-conflict check. 157 tests pass across 17 files.

- **READMEs rewritten (2026-08-18):** `README.md` restructured along
  conventional open-source lines (why, quick start, concepts, configuration,
  CLI, HTTP API, auth/claims, portability, deployment, development, roadmap,
  contributing) and `ui/README.md` replaced (it was still the stock Vite
  template). Documentation only, no behavior change. Writing them against the
  code surfaced four drifted claims in the old README, now corrected: entry
  list responses are `{"data": ...}`, not `{"items": ...}` (collections,
  projects and envs *do* return `items`); key creation lives at
  `/servers/:serverId/settings/keys/new`, not `/s/:serverId/keys/new`; the
  "HTTP API stays flat, every request runs against a default scope" paragraph
  predated D19/D20; and `default_project`/`default_env`, `SILO_DEFAULT_*`,
  `serve --project/--env`, the `X-Api-Key` header, and the media endpoints were
  undocumented. Two facts are documented as they behave rather than as
  IMPLEMENTATION.md describes them: the admin UI is served from `./ui/dist`
  relative to the process working directory (no `go:embed` equivalent, so a
  compiled binary is not self-contained), and `EntryUtils.toApiResponse` omits
  `rev`, so the `If-Match`/`?rev=` requirement on entry `PUT`/`DELETE` is
  documented without claiming the API hands clients a revision to send.
  (That second one was a bug, not a documentation nuance — fixed 2026-08-20
  below, and the README now says the response carries `rev`.)
  Neither README links CONTEXT.md or IMPLEMENTATION.md any more: they are
  working docs for contributors, not part of the public front door, so the
  conventions and format-stability points the README needed are now stated
  inline. The roadmap section names MCP support, third-party storage/blob
  adapters against a published conformance suite, and richer backup options
  (scheduled and incremental exports, retention, remote targets), with the
  older designed-for work (sync, tombstones, key expiry, relations, search)
  kept as one closing line.
  The pitch was then reframed (2026-08-18, same day): the README used to lead
  with portability, which is a *consequence*, not the reason to pick silo. The
  opening and the "Why silo" section now lead with four pillars, simple,
  lightweight, standard, and customizable, each stated concretely (one process
  and no user accounts; six runtime deps and no sidecar services; JSON Schema,
  JSON, REST, ULID, RFC3339, tar, S3, TOML; ports plus per-key claims plus
  `x-silo-*` keywords plus a replaceable admin client), with portability
  presented as what those four add up to. The one-line pitch is "A small,
  standards-based headless CMS. Define collections in JSON Schema, get an admin
  UI with generated forms and a REST API, and swap out any part of it."
  `package.json`'s `description` and the CLI usage banner still carry the older
  "minimal portable headless CMS" framing and were left alone.

- **Project/env review fixes (2026-08-18):** review of the project/env work
  found the two adapters had drifted apart on the new port surface, and that
  scoping had opened holes the flat namespace never had. All fixed in this
  change set.
  - **A scope exists when it was created explicitly *or* still holds content**
    — both halves, both adapters, now stated on the `Storage` port and pinned
    by conformance. SQLite already answered this from its `projects`/
    `environments` rows; the fs adapter had only directories, which are
    ambiguous (nothing prunes the tree when a scope's last schema and entry
    go), so it answered "content only". Two bugs fell out of that single
    divergence, and neither was reachable by the test suite because the only
    coverage for the six new port methods lived in `projects-api.test.ts`,
    which runs on SQLite alone:
    - **Empty projects and envs were dropped from every fs export.**
      `Exporter` enumerates `listScopes()`; fs reported nothing for a
      registered-but-empty scope, so `silo export` on the fs driver silently
      lost it. The existing round-trip guard passed only because it ran on
      SQLite.
    - **Ghost projects on fs.** Deleting the last schema/entry of a scope that
      was never created explicitly left it listed by `listProjects()` and
      `listEnvironments()` forever, where SQLite dropped it.
    `FsStore` now writes a `.silo-project`/`.silo-env` marker on create — the
    directory equivalent of the row — and derives all three listings from
    "marker or content". The six methods are covered in
    `storage-conformance.ts`, so both drivers are held to one answer.
  - **`initDefaults` validates its ids** (`--project`/`--env`,
    `default_project`/`default_env`, `SILO_DEFAULT_*`). Unvalidated, a typo
    such as `SILO_DEFAULT_ENV=PROD` created a project that `GET /api/projects`
    listed, no scoped route could address (`Scope.of` rejects it at the
    boundary), and `deleteProject` refused to delete for the same reason —
    unreachable and unremovable. `serve` now fails at startup instead.
  - **`force` guards collections, not just entries.** `deleteProject`/
    `deleteEnvironment` counted rows only, so an un-forced delete destroyed
    every schema in a scope and reported `204` — the normal state of a project
    right after it is modelled. `deleteProject` also now inspects every env
    before erasing any of them, so a conflict in a later env can't leave
    earlier ones already emptied.
  - **Project enumeration is claim-scoped.** `GET /api/projects` treated any
    *fixed* claim as instance-wide visibility, so a key holding only
    `media:read` could list every tenant's project name. Visibility now comes
    from collection claims alone, matching what the env listing already did.
  - **`transfer:*` no longer escapes a key's scope (D21).** An archive spans
    every project and env, so `transfer:export` alone let a project-scoped key
    read every other project (and `transfer:import` overwrite them). Export
    now also requires `collections:*/*/*` `schema:read` + `entries:read`;
    import and copy require `collections:*/*/*` `entries:create`/`:update`/
    `:delete`. Media stays instance-global and unscoped — a known deferral,
    now called out as one rather than implied.
  - **Anonymous project/env discovery is cached.** It has to know which scopes
    expose a public collection, which means reading every schema in the
    instance — an unauthenticated request walking every project × env × schema
    on every call. `Service.publicScopes()` derives it once and drops it
    alongside the compiled-validator cache.
  - **`ProjectRegistry` deleted.** D20's dedicated tables superseded D19's
    `_projects` collection; nothing had written it since, and the docs
    described it as live in four places while contradicting themselves in a
    fifth.
  - `Scope.validateProject`/`validateEnv` replace `Scope.of(project, "prod")`
    as the project-only validator, and the `/environments` + `/envs` route
    pair is registered from one handler so authorization can't drift between
    the two spellings.
  - 153 tests pass across 17 files.

- **General Settings Tab & Theme Customization (2026-08-18):**
  Added a **General** tab to the Settings view for personalized typography and accent color theming.
  - **Google Fonts Support:** Users can pick from curated Google Fonts (Hanken Grotesk, Inter, Outfit, Plus Jakarta Sans, Poppins, DM Sans, Space Grotesk, Montserrat, Playfair Display, JetBrains Mono, Syne, etc.) or type any Google Font name to dynamically inject and apply `--font-ui`.
  - **Accent Color Customizer:** Preset color swatches (Indigo, Violet, Sky, Cyan, Emerald, Teal, Amber, Coral, Rose, Magenta, Sunset, Lime) plus native color picker and HEX input updating `--accent`, `--accent-soft`, and `--accent-ink`.
  - **Persistence & ThemeManager:** `ThemeManager` (`ui/src/utils/theme-manager.ts`) persists user preferences in `localStorage` (`silo_appearance_settings`) and initializes them on app bootstrap (`ui/src/main.tsx`) with zero flash of unstyled content.
  - **Live Previews & Reset:** Real-time preview card for typography and UI elements, along with a "Reset to Defaults" action.

- **Decoupled Projects & Environments Architecture (2026-08-18):**
  Decoupled `Scope` into individual `Project` and `Environment` entities (D20 in IMPLEMENTATION.md).
  - **SQL Tables:** Dedicated `projects` (`id, created_at, updated_at`) and `environments` (`project, id, created_at, updated_at, PRIMARY KEY (project, id)`) tables.
  - **Server Defaults:** Defaults to `project: default, env: prod` on startup via `Service.initDefaults(...)`. Configurable via `--project` and `--env` CLI flags, TOML configuration, and environment variables `SILO_DEFAULT_PROJECT` and `SILO_DEFAULT_ENV`.
  - **Individual Storage & REST APIs:**
    - `createProject(project)`, `listProjects()`, `deleteProject(project, force)`
    - `createEnvironment(project, env)`, `listEnvironments(project)`, `deleteEnvironment(project, env, force)`
    - Endpoints: `GET /api/projects`, `POST /api/projects`, `DELETE /api/projects/:project`, `GET /api/projects/:project/environments`, `POST /api/projects/:project/environments`, `DELETE /api/projects/:project/environments/:env`.
  - **Key Scoping:** Keys can be scoped to an entire project (`project/*/*`), a specific environment (`project/env/*`), or specific collections.
  - **Multi-Pane UI:** The `/servers` UI has been expanded into a 3-pane macOS column / Ranger file manager browser (Pane 1: Server, Pane 2: Project, Pane 3: Environment) with inline creation and deletion.
  - **In-App Navigation & Deep URLs:** In-app scope switching was removed in favor of navigating back to the `/servers` multi-column browser. Application URLs are strictly scoped as `/servers/:serverId/projects/:project/environments/:env/...`.
      single mutex acquisition rather than through `deleteCollection`, since its
      per-collection entry and `$ref`-referrer checks are moot when every
      referrer in the scope is being deleted too.
  - **`Storage.listEntryCollections(scope)`** (new port method, both adapters +
    conformance) reports collections that hold entries but no schema. An import
    archive can carry `content/<collection>/` with nothing under `schemas/`;
    those entries are invisible to every schema-derived listing. Two separate
    bugs came from that blind spot, and both are fixed:
    - `DELETE /api/projects/...` returned `204` and changed nothing, leaving a
      scope that `listScopes()` kept reporting and no API call could remove.
      `CollectionEraser.erase` now treats a missing schema as success.
    - `Exporter.exportScope` enumerated content collections from `listSchemas()`
      alone, so those same entries were dropped from **every** archive. It now
      unions schema names with `listEntryCollections()`, which also removes the
      need to name the system collections explicitly — `skipCollection` still
      decides what is allowed out, so `_keys` stays behind `--with-keys`.
  - **`deleteProject` enumerates via `store.listSchemas()`, not
    `Service.listCollections()`.** That helper hides `_`-prefixed names, and
    `Storage.putSchema` has no name validation (only `Service.putSchema` applies
    `Claims.isCollectionName`), so an archive carrying
    `schemas/_secret.schema.json` plants a system-named schema in a *user*
    scope — the schema-side mirror of the entry-only hole above, with the same
    "204 that deletes nothing" outcome. A caller-supplied scope can never be
    `Scope.System` (its ids cannot start with `_`), so erasing `_`-prefixed
    collections found this way cannot reach `_keys`.
  - **Admin UI Multi-Pane Architecture:**
    - The `/servers` manager is now a 3-pane macOS column / Ranger file manager style browser:
      - Column 1: Servers list with add/remove server modals and connection state.
      - Column 2: Projects list within the selected server with inline project creation and deletion.
      - Column 3: Environments list within the selected project with inline environment creation and deletion.
    - Connecting opens the workspace at `/servers/:serverId/projects/:project/environments/:env/collections`.
    - In-app scope switching was removed in favor of navigating back to the `/servers` view.
    - Deep application URLs carry `:serverId`, `:project`, and `:env`.
    - Key management (`/keys/new`) allows selecting Scope Level: Environment, Project, or All Projects.
    - `ApiClient` methods explicitly scope operations with `project` and `env`. Claim checks in the UI pass the active scope.
    `Claims.hasAnyCollectionPermission(claims, perm, project, env)` and
    four-argument `Claims.collection(project, env, name, perm)` — and `NewKey`
    mints collection claims targeting the active scope rather than `*/*/*`.
    `Claims.isScopeId` (shared) is what the UI validates typed ids against, so
    the grammar isn't restated a third time.
  - 129 tests pass across 17 files.

- **Projects & environments, storage-layer scoping (2026-08-18):** a
  collection is now identified by **(project id, env id, collection name)**,
  not name alone — D18 in IMPLEMENTATION.md, superseding D15's revert.
  Projects and envs are plain string-pair containers with no metadata and no
  registry: `Scope` (`server/core/domain/scope.ts`) validates ids against the
  same grammar as collection names (`^[a-z][a-z0-9_-]{0,63}$`, defined once,
  not shared with `@silo/shared/claims`), exposes `Scope.System`
  (`_system`/`_system`) and `Scope.Default` (`default`/`default`), and a scope
  "exists" only because it has content — `Storage.listScopes()` derives the
  list from what's actually on disk/in the table, sorted, excluding
  `Scope.System`. There is no `_projects` registry collection.
  - **This phase is storage/domain only.** The HTTP API stays flat: every
    route in `collections-routes.ts`/`entries-routes.ts` passes `Scope.Default`
    explicitly (no default parameter on `Service` methods — the constant is
    the grep target for the API phase that scopes routes from the URL path).
    `@silo/shared/claims` is untouched — the claim grammar does not yet
    encode scope. Media storage stays instance-global. Export/import stay
    instance-wide (no `--project`/`--env` flags yet). All of these are
    explicit deferrals to later phases, not oversights.
  - `Entry` gained `project`/`env` fields alongside `collection`; `Storage`,
    `Service`, `SchemaValidator`/`SchemaBundler`, and the export/import engine
    all take an explicit `Scope` (except key/media/export-import methods,
    which use `Scope.System` internally or stay unscoped). `CollectionEraser`
    and `Service.findSchemaReferrers` are scope-aware, so a `$ref` referrer
    check or a collection delete only ever considers the same scope.
  - **On-disk/export format is now `format_version` `"2"`** (breaking,
    pre-1.0, no migration): the fs layout and export tree moved from flat
    `schemas/`+`content/` to `projects/<project>/<env>/{schemas,content}/...`,
    with `_keys` living at the reserved `projects/_system/_system/...` pair —
    no branch in the adapter, it's stored exactly like any other scope. The
    SQLite `schemas`/`entries` tables gained `project`/`env` columns in their
    primary keys. Both adapters guard against opening a data dir stamped with
    a different `format_version`: `SqliteStore.open` checks `meta.format_version`
    before running DDL and, since that row alone can't rule out a pre-D18 db
    with old-shaped tables and no such row, also inspects `schemas`/`entries`
    directly via `PRAGMA table_info` for a missing `project` column;
    `FsStore.open` checks `manifest.json` before creating anything (a
    refused dir gets no stray `projects/` directory). Both throw an
    actionable message rather than crashing on a missing column or silently
    reading nothing. `seq` stays instance-global and monotonic across every
    scope. `Storage.put`/`get`/`delete`/`list` validate `collection`/`id`
    (and, on `put`, `project`/`env` read off the entry) as safe path segments
    via `EntryUtils.assertSafeSegment` — a port contract both adapters
    enforce identically, not an fs-only concern, because `ImportWalker`
    builds an entry's `id` from archive file *contents*, not the trusted
    archive path. The length cap is **255 bytes** (`Buffer.byteLength`, not
    `.length`): the fs adapter turns these values into filenames, so a looser
    or character-counted cap would let SQLite accept a value that fs rejects
    mid-write with a raw `ENAMETOOLONG` — a divergence the whole point of the
    contract is to prevent, and one a multi-byte unicode id would slip
    through. `listScopes()` on both adapters only reports a scope that
    still holds a schema or an entry (fs actively checks directory contents
    rather than trusting that a directory pair exists) and both skip any
    `_`-prefixed project/env and any row/directory pair that fails `Scope.of`
    instead of throwing and taking the caller down with them.
    `ExportManifest.collections` is now keyed by
    `"<project>/<env>/<collection>"`. `ImportWalker` walks the scoped tree
    only (the flat walkers are gone, not kept alongside); scope and collection
    name come from the archive path, which wins over whatever an entry file's
    own `project`/`env` fields say. Replace-mode import deletes archive
    collections within their own scope only. The fs adapter applies the same
    rule to its own reads: `FsStore.parsedToEntry` takes `project`/`env`/
    `collection`/`id` from the path that located the file and never from the
    envelope inside it. A forged `id` there is not cosmetic — it produced an
    entry `list` returned but `get`/`delete` could not find, which left the
    collection permanently undeletable, since `CollectionEraser` lists and
    then deletes each id it was handed.
  - **Imports are not atomic** (documented in IMPLEMENTATION.md §7.2): a
    rejected segment or a disk error mid-walk leaves prior writes in place
    and returns the error instead of an `ImportResult`. A failed import means
    "unknown state", not "no-op"; `--dry-run` is the way to vet an untrusted
    archive first.
  - Tests: `server/test/core/scope.test.ts` (new) covers id validation,
    `key()`, `equals()`, and `System`/`Default` identity. The storage
    conformance suite (`server/test/conformance/storage-conformance.ts`, run
    against both adapters) gained scope-isolation, cross-scope `seq`
    monotonicity, `listSchemas`/`listScopes` scoping (including pruning a
    scope once its last schema/entry is deleted), the same entry id staying
    distinct across two scopes, system-scope visibility cases, and a
    port-contract case asserting both adapters reject the same malformed
    `collection`/`id`/`project`/`env` values identically.
    `server/test/adapters/fs.test.ts` and `sqlite.test.ts` each gained a
    `describe` block exercising that adapter's data-dir format-version guard
    directly (including, for SQLite, old-shaped tables with no
    `format_version` row at all). `server/test/http/export.test.ts` covers
    an export/import round trip that keeps two scopes' same-named
    collections distinct on both adapters (not SQLite-only), plus rejecting
    a hand-crafted archive whose entry `id` is a path-traversal string and
    confirming nothing is written outside the destination data dir. 113
    tests pass (up from a pre-scoping baseline of 83).
- **Shared claims package (2026-08-17):** claim names, collection permissions,
  validation/normalization, wildcard matching, delegation, presets, and UI
  capability discovery now have one runtime-neutral implementation in the
  local `@silo/shared` package under `shared/`. Both the Bun server and React UI
  depend on that package. The former `server/core/keys/ClaimUtils` and
  `ui/src/auth/Claims` implementations were removed, and shared behavior is
  tested under `shared/test/`. Docker copies the local package into both build
  stages before their frozen installs.
  - The root `package.json` declares `"workspaces": ["shared"]` and depends on
    `@silo/shared` via `workspace:*`. This matters: with the previous
    `file:./shared` protocol Bun **copied** the package into `node_modules`, so
    the server kept running a stale snapshot after every edit to `shared/` while
    `shared/test/` (which imports by relative path) tested the new code — one
    `bun test` run could report green on two different versions. Workspaces
    symlink the directory, so both halves always see the same source.
  - `ui/` is a separate install root and still uses `file:../shared`, which Bun
    mirrors as **per-file** symlinks: edits to an existing shared file propagate,
    but **adding or removing a file under `shared/src/` requires
    `cd ui && bun install`** before the UI can resolve it. TypeScript resolves
    new subpaths through the package's realpath and will typecheck clean without
    that reinstall, so the failure surfaces at bundle time, not at `tsc`.
  - Errors that cross this boundary are identified by **brand, not
    `instanceof`**. `ValidationError` carries a `brand` field and a static
    `ValidationError.is()` guard, and every catch site uses it. `instanceof`
    would compare prototype identity, which holds only while exactly one copy of
    the module is loaded — the same install-layout assumption the two bullets
    below describe. A guard test asserts `@silo/shared` resolves to one on-disk
    copy from every install root, so a regression fails loudly instead of
    silently turning 400s into 500s.
  - Whole claims are typed. `Claim` (`shared/src/claims/claim.ts`) is the union of
    root, `FixedClaim`, and `CollectionClaim`, and it is what `Claims.has`/`any`/
    `canDelegate` and `RouteAuth.requireClaim` accept. The `Claims.Collection*`
    constants are bare `CollectionPermission` fragments (`"entries:read"`), not
    claims; before this typing they satisfied a `string` parameter and turned
    into a silent permanent deny. Scope them with `Claims.collection(name, perm)`.

- **Production container refreshed (2026-08-14):** the Docker build now uses
  Bun 1.3.14, installs both dependency trees from their committed `bun.lock`
  files with `--frozen-lockfile`, and runs as the unprivileged `bun` user. The
  default filesystem blob path is `/data/media`, so an explicit runtime mount
  at `/data` persists both SQLite data and media (including Railway Volumes;
  the Dockerfile intentionally has no `VOLUME` instruction because Railway
  rejects it). The runtime image also exposes a Docker health check backed by
  `GET /api/health`; the build context excludes root dependencies and server
  tests.
- **Repo restructure (2026-08-13):** `src/` and `test/` are gone. Server code
  now lives under `server/` (sibling to `ui/`), tests under `server/test/`.
  The move was purely mechanical — one exported artifact (class, interface,
  standalone function, React component) per file, grouped into feature
  directories (`shared/src/claims/`, `server/core/{domain,ports,query,errors,schema,keys,media,transfer,service}/`,
  `server/adapters/{storage/sqlite,storage/fs,blob,http}/`, `server/http/{routes,auth,middleware}/`,
  `server/cli/{,commands}/`, `server/config/`; `ui/src/{api,api/types,schema,components,forms,router,styles,utils,views/*}/`).
  No behavior changed. See the Repo map and Code Design Rules sections below
  for the new layout.
- **UI styling is owner-scoped (2026-08-13):** the former 2,859-line
  `ui/src/styles.css` monolith is deleted. React components, RJSF artifacts,
  and feature views now own colocated `*.module.css` files; shared visual
  primitives such as buttons, segmented controls, modals, and data tables live
  under `ui/src/components/`. Only tokens, the document reset, cross-screen
  page/form primitives, feedback, and a short utility list remain global under
  `ui/src/styles/`. Stylelint runs as part of `bun run lint` and catches invalid
  CSS, duplicate declarations, selectors, and keyframes.
- **Dead code removed (2026-08-13):** `ui/src/views/keys/KeyGate.tsx`, the old
  single-key login gate, is deleted — nothing imported it since multi-server
  support replaced it with `ServerManager` (`ui/src/views/servers/ServerManager.tsx`),
  which is the welcome screen shown on first visit and after any `401`.
  IMPLEMENTATION.md's key-gate mentions (§8 auth, §9 layout/view 1, M3) now
  describe the server manager. KeyGate's orphaned styling was removed; the
  welcome screen is fully owned by `ServerManager.module.css`.
- **Phase: Pluggable Blob Adapter Pattern & S3 Support Complete.**
  - Media/file storage is fully abstracted behind a pluggable `BlobStorage` interface (`server/core/ports/blob-storage.ts`).
  - **Blob Storage Adapters:**
    - **Filesystem Adapter (`FsBlobStorage`):** Stores media files locally in a designated directory (`silo_data/media`). Default behavior.
    - **S3 Adapter (`S3BlobStorage`):** Uses `@aws-sdk/client-s3` to support AWS S3 and S3-compatible providers (MinIO, Cloudflare R2, DigitalOcean Spaces, etc.).
    - **Factory (`BlobStorageFactory`):** Configured via `[blob_storage]` in `silo.toml` or `SILO_BLOB_*` environment variables.
  - **Export/Import Media Portability:** `Exporter` and `Importer` use `BlobStorage` to seamlessly export and import media files across any backend.
- **Direct server copy is available:**
  - A key with `transfer:copy` can pull a complete export from another running silo through `POST /api/copy` or the admin UI's **Data transfer** view.
  - The source URL and a source key with `transfer:export` are required. Copy composes the existing export/import engines, supports merge or replace with a dry-run preview, and includes schemas, entries, and media.
  - **Data only** preserves destination API keys. **Data + API keys** exports the source `_keys` hashes; replace mode replaces destination keys and the UI switches its saved destination credential to the supplied source key after success.
  - Data-plus-keys additionally requires `keys:export` on the source and `keys:import` on the destination.
  - `server/adapters/http/http-silo-client.ts` owns source HTTP access. Source credentials are held only for the request and are never persisted by the destination server.
- **Phase: TypeScript/Bun/Hono migration complete, plus multi-server support.**
  - The Go backend has been fully migrated to TypeScript, running natively on **Bun** and using the **Hono** web framework.
  - Storage is pluggable via a common `Storage` interface in TypeScript:
    - **SQLite adapter** uses `bun:sqlite`.
    - **Filesystem adapter** stores collections and schemas in a flat layout on disk.
  - **Multi-Server Support:** The backend projects nesting has been reverted in favor of flat collections namespaces (API endpoints `/api/collections...` without route prefixes). The frontend UI dynamically manages a list of active servers in the browser's `localStorage` and lets users switch between them.
  - API keys carry explicit capability claims; the old role/collection-allowlist key format is intentionally unsupported.
  - Export `format_version` is `"1"` (flat on-disk layout: `schemas/...`, `content/...`).
  - The Admin UI has a clean welcome screen with server configuration forms, letting users manage, delete, and connect to multiple silo instances.
  - A comprehensive conformance test suite translated to `bun test` ensures matching behavior across storage backends, blob adapters, and export/import round-trips.

- **Schema references (`$ref`) are supported end to end:**
  - Schemas can reference other collections via `silo://collections/<name>` (every collection schema is registered in Ajv, so refs — including recursive ones — resolve locally) or remote `http(s)` URLs.
  - **Schema Bundling (`SchemaBundler`):** Upon saving or updating schemas, `Service.putSchema` automatically fetches referenced local and remote schemas and embeds them into `$defs`. The property's original reference URL (`silo://collections/<name>` or remote URL) is preserved, making the schema document self-contained.
  - Remote refs are **rejected by default** with an actionable error naming the fix; the `[schema] allow_remote_refs` config key (env `SILO_SCHEMA_ALLOW_REMOTE_REFS`) opts in. When enabled, `SchemaValidator` compiles with `ajv.compileAsync` and `RemoteSchemaLoader` fetches missing refs (http/https only, 10s timeout, in-memory cache cleared on schema change).
  - Deleting a collection that another schema `$ref`s fails with `409` unless forced (`Service.findSchemaReferrers`).
  - The visual schema builder offers a **Reference** field type: a local-collection dropdown or a remote-URL input. For entry forms, `SiloRefs.resolveForForm` (`ui/src/schema/silo-refs.ts`) inlines referenced collection schemas under `$defs` keyed by their silo URL and rewrites refs to internal `#/$defs/...` pointers, because RJSF's renderer and ajv8 validator only follow internal pointers. Remote, unknown-collection, and cycle-closing refs become permissive marker nodes (`x-silo-unresolved-ref`) rendered as the raw-JSON fallback field — the server stays authoritative for those.

## Architecture in one minute

- **Ports and adapters.** `server/core/` defines domain types and the `Storage`/`BlobStorage` interfaces (under `server/core/ports/`), importing no adapters; adapters live under `server/adapters/`; `server/cli/cli.ts` (the `Cli` class, run from `server/main.ts`) wires everything explicitly from config.
- **Document model.** Entries are JSON blobs in an envelope (`id` ULID, `project`, `env`, `collection`, `rev`, `seq`, timestamps) — never schema→table mapping. This keeps storage adapters cheap.
- **Scoping.** A collection is identified by `(project, env, collection)` (D18/D19/D20), where project/env are plain string containers validated by `Scope` (`server/core/domain/scope.ts`) — no metadata beyond the two ids. Projects and envs are recorded explicitly (SQLite `projects`/`environments` tables; marker files in the fs adapter) so an empty one can exist, and a scope **exists when it was created explicitly *or* still holds a schema or an entry** — both halves, in both adapters. `Scope.System` (`_system`/`_system`) holds silo-reserved data (`_keys`). `seq` stays instance-global across every scope.
- **Storage adapters:** SQLite (`bun:sqlite` built-in) and filesystem. The fs adapter's on-disk layout **is** the export format (frozen, public, versioned via `format_version`, currently `"2"`) — `projects/<project>/<env>/{schemas,content}/...`.
- **Schemas:** full JSON Schema draft 2020-12, validated server-side via **AJV 2020**. Refs to other collections use `silo://collections/<name>` and resolve only within the same scope; remote `$ref`s are rejected by default (opt-in via `[schema] allow_remote_refs`).
- **Auth:** Shlink-style API keys with claims. A root (`*`) key is generated at first boot. Each protected operation checks one explicit claim, including scoped collection schema/access/entry CRUD (`collections:<project>/<env>/<name>:<permission>`), media, key-management, and transfer claims. Independent per-segment wildcards are supported (e.g. `collections:acme/*/*:entries:read`). `ParsedClaim` validates and enforces non-escalating delegation: a key with `keys:create` can mint only a subset of its own claims, and named segments cannot widen to wildcards. Action wildcards are not accepted. Collection schema and entry reads remain public by default for anonymous requests unless `"x-silo-auth": true` is set. Once a key is presented, its claims are the visibility boundary, so scoped keys do not see unrelated public collections.
- **API:** clean routes under `/api`, no URL versioning. JSON everywhere. Collection and entry routes are scoped under `/api/projects/{project}/envs/{env}/collections/...`, with scope listing and creation at `/api/projects`. Optimistic concurrency via `rev` + `If-Match` or `?rev=`. Transfer comes at two blast radii: the whole-instance archive (`/api/export`, `/api/import`, `/api/copy`, gated on instance-wide authority per D21) and a scope-to-scope copy (`/api/projects/{project}/envs/{env}/copy`, gated only on the scoped collection claims it exercises — D22).

## Repo map

| Path | What it is |
|------|------------|
| `IMPLEMENTATION.md` | Design spec + decisions log (D1–D20) |
| `CONTEXT.md` | This file — current state of the project |
| `CLAUDE.md` | Standing instructions for AI assistants |
| `package.json` | Project metadata, TypeScript 7 setup, Bun/Hono dependencies, and AWS S3 SDK; declares the `shared` Bun workspace |
| `tsconfig.json` | TypeScript configuration for the Bun server and shared package (`include: ["server/**/*", "shared/**/*"]`) |
| `shared/` | Local `@silo/shared` package (a Bun workspace of the root) for runtime-neutral client/server rules. `src/claims/` is the single source of truth for claim constants, the `Claim`/`FixedClaim`/`CollectionClaim`/`CollectionPermission`/`ClaimPreset` types, `ParsedClaim`, validation, matching, delegation, and presets; `src/errors/` holds `ValidationError` and the `ValidationDetail` wire shape; `src/schema/` holds `SiloRef` (the `silo://collections/` `$ref` scheme), `SchemaAccess` (`x-silo-auth`), and `MediaField` (`x-silo-type: "media"`); `src/keys/` holds `KeyFormat` (secret prefix and display truncation). Tests under `shared/test/`. Each artifact is its own file and its own `exports` subpath |
| `server/main.ts` | Thin CLI entrypoint — imports `Cli` and runs it |
| `server/cli/` | `cli.ts` (argv parsing, subcommand routing, dependency wiring) and `commands/` (one command class per subcommand: `serve-command.ts`, `keys-command.ts`, `export-command.ts`, `import-command.ts`) |
| `server/config/` | `Config` type and its sub-shapes (`storage-config.ts`, `blob-storage-config.ts`, `auth-config.ts`, `schema-config.ts`) plus `ConfigLoader` (`config-loader.ts`) |
| `server/core/domain/` | `Entry`, `Meta`, `EntryUtils`, `Collection`, `Scope` |
| `server/core/ports/` | `Storage` and `BlobStorage` port interfaces |
| `server/core/query/` | Query AST (`Filter`, `SortKey`, `Query` + limits) and `QueryUtils` |
| `server/core/errors/` | One error class per file (`NotFoundError`, `ConflictError`, `UnauthorizedError`, `ForbiddenError`). `ValidationError` lives in `@silo/shared` because shared rules raise it |
| `server/core/schema/` | `SchemaValidator`, `SchemaBundler`, `RemoteSchemaLoader` (Ajv 2020 validation, `$ref` bundling) |
| `server/core/keys/` | Server-only key persistence/secret concerns: `KeyInfo`, `KeyUtils` (generation and hashing; the wire format lives in `@silo/shared`'s `KeyFormat`) |
| `server/core/media/` | `MediaMetadata`, `MediaResolver`, `MimeUtils` |
| `server/core/transfer/` | Export/import engine: `FormatVersion`, `Exporter`, `Importer`, `ImportWalker`, `ScopeCopier` (scope-to-scope copy, D22 — reuses `Importer.executeImport` rather than forking its merge logic), and their options/result/manifest types |
| `server/core/service/` | `Service` (orchestration), `KeyView`, `AsyncMutex`, `CollectionEraser` |
| `server/adapters/storage/sqlite/` | `SqliteStore` + `SqliteCompiler` (query compiler) |
| `server/adapters/storage/fs/` | `FsStore` + `FsFilter` + `FsManifest` |
| `server/adapters/blob/` | `FsBlobStorage`, `S3BlobStorage`, `BlobStorageFactory` (imported directly — no barrel) |
| `server/adapters/http/` | `HttpSiloClient` (+ `Fetcher` type) — the authenticated HTTP source client for direct copy |
| `server/http/server.ts` | `SiloServer` class — builds the Hono app (middleware, routes, static UI serving with SPA fallback) |
| `server/http/middleware/` | `LoggingMiddleware`, `AuthMiddleware` |
| `server/http/auth/` | `RouteAuth` — claim-checking helpers for route handlers |
| `server/http/routes/` | `RouteManager` plus one routes class per resource (`projects-routes.ts`, `collections-routes.ts`, `entries-routes.ts` + `request-utils.ts`, `keys-routes.ts`, `media-routes.ts`, `transfer-routes.ts`, `copy-routes.ts` + `copy-request.ts` + `scope-copy-request.ts`, `session-routes.ts`). `CopyRoutes` serves both the whole-instance `/api/copy` and the scoped `/api/projects/:p/environments/:e/copy` |
| `server/test/` | Test suites running via `bun test`: `conformance/` (storage conformance suite), `adapters/`, `core/`, `http/` (claims enforcement/delegation, entries API, export/import, direct server copy, scope-to-scope copy, media, schema `$ref`, projects API tests) |
| `ui/` | React + TS + Vite SPA (Slate design), organized into feature dirs (`api/`, `schema/`, `components/`, `forms/`, `router/`, `utils/` with `Formatters`, `ThemeManager` & `ScopeMemory`, `views/*`) with colocated CSS Modules and a small global foundation under `styles/`. Every collection/entry call is scoped through `ApiClient.collectionsPath`; the active `(project, env)` is part of the URL, switched from the `/servers` gate in the workspace and from the settings nav's scope switchers. Shared protocol rules come from `@silo/shared`; `ui/dist` contains the compiled SPA served at the web root. `src/**/*.test.ts` are `bun test` suites in their own TS project (`tsconfig.test.json`) and run from the repo root alongside the server's |
| `README.md` | User-facing docs: why/quick start, concepts, configuration, CLI, HTTP API, claims, portability, deployment, development, roadmap, contributing. Rewritten 2026-08-18; deliberately links neither this file nor IMPLEMENTATION.md |
| `ui/README.md` | Admin UI docs: dev workflow, the server-connection model, URL grammar, RJSF theme notes, styling conventions, and the `@silo/shared` per-file-symlink caveat. Rewritten 2026-08-18 (was the stock Vite template) |


Notable implementation facts:

- Optimistic concurrency lives in `Service` behind a single async write mutex (`AsyncMutex`) — sound because silo is single-process; storage adapters stay CAS-free.
- Query field paths are never interpolated into SQL; they reach `json_extract` as bound parameters.
- Dependencies: `hono` (HTTP router), `ajv` + `ajv-formats` (JSON Schema Draft 2020-12), `ulidx` (ULID), `tar` (archive creation/extraction).
- `format_version` has one source of truth: `FormatVersion` (currently `"2"` — the `projects/<project>/<env>/...` scoped layout, D18). It is stamped into the SQLite `meta` table, the fs `manifest.json`, and every export manifest. Both adapters refuse to open a data dir stamped with a different version rather than misreading it.
- Direct copy is destination-driven: `transfer:copy` authorizes the destination route, while `transfer:export` authorizes `/api/export` on the source. Copying key hashes also requires `keys:import` at the destination and `keys:export` at the source. Replace retains normal import semantics (source-present collections are replaced; source-absent collections remain untouched).
- Claims are defined in `shared/src/claims/`, not in either application. Add new
  fixed claims or collection permissions there so validation, server
  authorization, UI visibility, delegation, and presets cannot drift. The
  compiler enforces the rest: `Claims` holds its lookup tables as
  `Record<Union, true>` keyed by the constants, so extending `FixedClaim`,
  `CollectionPermission`, or `ClaimPreset` without listing the new member fails
  to typecheck, and a new `ClaimPreset` additionally trips the `never` guard in
  `fromPreset` until it decides what it grants. Those tables are plain objects —
  read them only with `Object.hasOwn`, never `in`, so inherited keys such as
  `constructor` cannot validate as claims.
- `ValidationError` and `ValidationDetail` live in `shared/src/errors/`, not in
  either application, because shared protocol rules must be able to raise them:
  `Claims.normalize` throws `ValidationError` directly and `SiloServer` catches
  that same class, so there is no translation layer and no way for a catch site
  to miss a second error type and downgrade a 400 into a 500. `ValidationDetail`
  is also the wire shape of `error.details`, which the UI's `ApiError` and RJSF
  error mapping now import instead of redeclaring. Mapping errors to HTTP status
  codes stays server-side in `SiloServer`.
- Because it is raised in one package and caught in another, `ValidationError` is
  matched with the static guard `ValidationError.is(err)` — never `instanceof`.
  `instanceof` asks "same prototype", which quietly becomes false the moment a
  second copy of `validation-error.ts` is loaded (a `file:`-copied dependency, a
  `dist/` build beside `src/`, a bundler with different export conditions).
  Nothing would crash: `SiloServer.onError` would fall through to a generic 500
  instead of `validation_failed` 400, and `Service.listKeys` would rethrow
  instead of skipping malformed key records. `is()` compares
  `ValidationError.Brand` by value, so it survives duplicate module instances.
  The three catch sites are `server/http/server.ts`,
  `server/core/service/service.ts`, and `server/core/schema/schema-validator.ts`.
  Two tests hold this: `shared/test/validation-error.test.ts` proves `is()` still
  matches an instance from a simulated duplicate copy that fails `instanceof`,
  and `server/test/core/validation-error.test.ts` catches a `Claims.normalize`
  error outside the package **and** asserts `@silo/shared` resolves to a single
  on-disk file from the root, `shared/`, and `ui/` install roots — the check that
  would have caught the copying `file:` protocol. `server/test/http/claims-api.test.ts`
  pins the resulting wire body.
- The other four error classes (`NotFoundError`, `ConflictError`,
  `UnauthorizedError`, `ForbiddenError`) stay in `server/core/errors/`: shared
  never raises them and the UI never throws them, so moving them would only add
  server-only throwables to a package the UI also resolves. They deliberately
  keep plain `instanceof` checks — they are defined, thrown, and caught inside
  `server/` under a single install root, with no package boundary and no second
  resolution path, so there is no duplicate instance to defend against. The brand
  marks a real boundary; it is not house style to copy onto every error class.
- `KeyUtils.parsePreset` defers to `Claims.isPreset` rather than restating the
  preset list.
- Protocol keywords and formats that both sides read or write now have one
  definition each in `@silo/shared`, replacing literals that were previously
  restated per call site: `SiloRef` (was three `localScheme` constants plus three
  copies of the fragment-stripping parse, in `SchemaValidator`, `SchemaBundler`,
  `RemoteSchemaLoader`, and the UI's `SiloRefs`), `SchemaAccess` (was
  `Service.hasAuthEnabled` plus open-coded `x-silo-auth` reads and writes across
  four UI files), `MediaField` (was `MediaResolver.isMediaField` plus inline
  checks in `build-ui-schema` and `SchemaEditor`), and `KeyFormat` (was
  `KeyUtils.keyPrefix`/`keyDisplayLen` mirrored by hand in
  `Formatters.displayPrefix`). `SiloRefs` in the UI keeps only the RJSF-specific
  `$defs` rewriting, which is not a shared concern.
- Query limits (`DefaultLimit`, `MaxLimit`, `MaxFilterDepth`, `MaxFilterNodes`)
  deliberately stay in `server/core/query/`: the UI picks its own `PAGE_SIZE` and
  never validates against the server's ceilings, so sharing them today would be a
  contract with no second consumer.
- The UI verifies credentials through `GET /api/session`, uses the returned claims to hide or disable unavailable actions, and creates keys on the dedicated `/servers/:serverId/settings/keys/new` page. Standard presets support searchable all/selected-collection scope; custom mode exposes a per-collection permission matrix and instance-level claims.
- Claims-based key listings ignore malformed obsolete key records instead of failing the whole response; those records are not translated or accepted for authentication. If no valid claims key exists at startup, bootstrap creates a new root key. The selected-collection chooser expands in normal page flow so it remains visible inside the key form.
- The React UI (in `ui/`) builds to `ui/dist` and is served by Hono. During development, Vite dev server hot-reloads against the Bun backend. The active server configuration is persisted in `localStorage` (`silo_servers` and `silo_active_server_id`).
- RJSF is **v6**: a custom Field's `onChange` signature is `(value, path, …)` — omit the path and the value is merged at the formData **root** (this bit the raw-JSON fallback field once; `JsonField` in `ui/src/forms/fields/JsonField.tsx` now passes `fieldPathId.path`).
- RJSF v6 also **dropped the top-level `formContext` prop** on widgets/fields — it now lives at `registry.formContext`. `MediaWidget` (`ui/src/forms/widgets/MediaWidget.tsx`) read the old prop and silently got no `url`/`apiKey`, so the media picker always reported "No media files found in server storage"; it now reads `registry.formContext` and surfaces load/upload failures instead of showing an empty library.
- Media fields (`x-silo-type: "media"`) render through `MediaWidget` in `ui/src/forms/widgets/MediaWidget.tsx`; its layout and responsive picker rules are colocated in `MediaWidget.module.css`. `EntryForm.module.css` stacks the form rail below the main form at `720px`, so media cards and other widgets retain usable width. The theme has no `--panel-1`/`--text-1`/`--radius-md`/`--border` tokens — use `--panel`, `--text`, `--radius-sm`, `--line`.

### UI styling conventions

- Put component- or feature-specific rules beside the owning `.tsx` file in a
  `.module.css` file. Use shared component primitives before introducing a new
  cross-feature selector.
- Keep globals limited to `ui/src/styles/`: `tokens.css`, `global.css`,
  `forms.css`, `layout.css`, `feedback.css`, and `utilities.css`. Adding a new
  global selector should represent a deliberately shared primitive, not a
  shortcut for a single screen.
- Static presentation belongs in CSS; inline `style` is reserved for values
  computed at runtime (for example a data table's schema-derived columns).
- Run `cd ui && bun run lint` after styling changes. CSS Modules are supported
  directly by Vite; no runtime CSS-in-JS dependency is used.

## Code Design Rules

- **Object-Oriented Design**: The codebase must be completely object-oriented. No loose, top-level functions are permitted. All utility methods, helper functions, and logic must be encapsulated within classes or static utility/helper classes.
- **File size guideline**: To maintain readability and clean separation of concerns, files should generally target a size of 100–150 lines of code. This is a guideline to prevent large, unreadable files rather than a strict rule, and cohesion/readability should be prioritized.
- **Logically modular**: Sub-components of infrastructure or service layers (such as filtering engines, query compilers, authorization helpers, or subcommand routing logic) should be modularized to keep core classes clean and cohesive.
- **One artifact per file**: every exported class, interface, standalone function, and React component gets its own file, except a type that exists only as that artifact's constructor-options/props shape (e.g. `S3BlobStorageOptions` stays with `S3BlobStorage`).
- **Directory structure**:
  - `server/cli/`: CLI subcommand execution handlers wrapped in command classes (`cli.ts` for argv parsing/wiring, `commands/` for one class per subcommand).
  - `server/config/`: `Config` and its sub-shapes, plus `ConfigLoader`.
  - `shared/src/`: Runtime-neutral logic shared by server and UI, consumed through the local `@silo/shared` package: claim protocol behavior under `claims/`, and under `errors/` the errors shared rules must be able to raise. Something belongs here when both sides need it *or* when shared itself must produce it; anything importing `bun:*`, node builtins, `hono`, or React does not.
  - `server/core/`: Domain models (`domain/`), port interfaces (`ports/`), query AST (`query/`), error classes (`errors/`), schema validation (`schema/`), server-only key persistence/secret logic (`keys/`), media helpers (`media/`), export/import engine (`transfer/`), and the `Service` orchestration layer (`service/`).
  - `server/adapters/`: Database / storage drivers (`storage/sqlite/`, `storage/fs/`) and their private helper classes (compilers, filters), blob storage drivers (`blob/`), and the outbound HTTP client (`http/`).
  - `server/http/`: HTTP web server definition (`server.ts`), routing handlers (`routes/`), claim-auth helpers (`auth/`), and web-specific middleware (`middleware/`).
  - `ui/src/`: `api/` (typed client, `EntryMapper`, and DTOs under `api/types/`), `schema/` (silo `$ref` resolution), `components/` (shared visual primitives), `forms/` (the RJSF theme: `templates/`, `widgets/`, `fields/`), `router/`, `styles/` (the intentionally global CSS foundation), `utils/` (`Formatters`, `ThemeManager`, `ScopeMemory`), and `views/` grouped by feature (`shell/`, `servers/`, `entries/`, `schema/`, `keys/`, `media/`, `transfer/`, `settings/` — whose shell, nav and scope switchers sit at its root and whose one-per-section pages sit under `pages/`).
