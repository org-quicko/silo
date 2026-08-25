# silo admin UI

The admin interface for [silo](../README.md): a React and TypeScript
single-page app, built with Vite, that talks to any silo instance over its REST
API.

The app is a client of the API, not a privileged part of the server. It holds a
list of servers in `localStorage` and can administer several instances from one
build, including instances it was not served from. In production the silo server
serves the compiled bundle from `ui/dist` at `/` with an SPA fallback.

## Contents

- [Quick start](#quick-start)
- [Scripts](#scripts)
- [Connecting to a server](#connecting-to-a-server)
- [URL structure](#url-structure)
- [Layout](#layout)
- [Forms](#forms)
- [Styling](#styling)
- [The shared package](#the-shared-package)
- [Production build](#production-build)

## Quick start

Requires Bun 1.3 or newer, and a running silo backend to point at.

```sh
# from the repository root, in one terminal
bun install
bun run server/main.ts serve

# in another
cd ui
bun run dev
```

Open the Vite dev server, add your backend on the welcome screen (name, URL such
as `http://localhost:8090`, and an API key), and the app verifies the pair
against `GET /api/session` before saving it. There is no dev proxy and none is
needed: the backend enables CORS on `/api/*`, and every request is made against
the saved absolute URL.

## Scripts

| Command | What it does |
|---------|--------------|
| `bun run dev` | Vite dev server with hot module replacement |
| `bun run build` | Type-check the project references, then build to `ui/dist` |
| `bun run preview` | Serve the production build locally |
| `bun run lint` | `lint:ts` then `lint:css` |
| `bun run lint:ts` | oxlint, configured in `.oxlintrc.json` |
| `bun run lint:css` | stylelint over `src/**/*.css`, configured in `stylelint.config.mjs` |

## Connecting to a server

`ApiClient` (`src/api/api-client.ts`) is the only place that speaks HTTP. Every
call takes the target server's URL and key explicitly and sends
`Authorization: Bearer <key>`, so nothing in the app depends on being hosted by
the instance it is administering.

- Saved servers live in `localStorage` under `silo_servers`, and the last
  connected one under `silo_active_server_id`. The URL is the source of truth
  for what is on screen; the active id only exists so a bare `/` can resolve.
- A key can be revoked while a tab is open, so any `401` clears the active
  server and returns the app to the server manager.
- Claims from `GET /api/session` drive what is visible. Actions the current key
  cannot perform are hidden or disabled rather than failing on click.
- Collection and entry calls are scoped: the client builds
  `/api/projects/{project}/environments/{env}/collections/...` from the active
  project and environment, both of which come from the URL.

Errors arrive as `ApiError` carrying the HTTP status, the server's error code,
and any validation details, which the entry form maps back onto individual
fields.

## URL structure

Routing is a small history-API store in `src/router/`, not a router dependency:
roughly ten routes with no data loaders, which keeps the bundle lean. `Routes`
(`src/router/routes.ts`) owns both building and parsing, so the URL grammar
lives in one file.

```
/servers                                                        server, project, and environment browser

# workspace
/servers/:serverId/projects/:project/environments/:env/collections
/servers/:serverId/projects/:project/environments/:env/collections/:name
/servers/:serverId/projects/:project/environments/:env/collections/:name/entries/:id
/servers/:serverId/projects/:project/environments/:env/collections/:name/schema
/servers/:serverId/projects/:project/environments/:env/schema/new
/servers/:serverId/projects/:project/environments/:env/media

# settings, nested under the scope each page configures
/servers/:serverId/projects/:project/settings/:section                    general, environments
/servers/:serverId/projects/:project/environments/:env/settings/:section  general, transfer
/servers/:serverId/settings/:section                                      projects, keys, transfer, connection, appearance, plugins
/servers/:serverId/settings/keys/new                                      key creation
/servers/:serverId/settings/plugins/:name                                 one plugin's grant, config and trail
```

Every workspace URL carries its server, project, and environment, so links are
shareable and a reload lands in the same place. Anything unparseable, including
`/`, redirects to `/servers`. Entry list state — text (`q`), the Query AST
(`filter`, as raw JSON), `sort` and `page` — is encoded in the query string, and
only non-default values are written so ordinary URLs stay clean.

An **absent `sort` means nobody chose one**, which is not the same as choosing
the default: the API gives a supplied `sort` precedence over relevance, so
writing the default out would make a text search unable to rank. The `filter`
travels as raw text and is parsed in the view rather than the router, because
one that cannot be read has to be *reported* — dropping it would widen the page
to everything while the URL still claims to be filtered.

Settings pages use the **same scope prefix** as the workspace routes, with
`settings` as the tail, so a workspace URL becomes its settings URL by swapping
that tail. The nav mirrors that nesting: one project's pages sit indented under
the project index and one environment's under that project's environment list,
each behind its own switcher, because neither exists outside the thing it hangs
off. Both nested blocks start collapsed and open when the route enters them. Server-level pages take no scope prefix on purpose: a key or a
connection belongs to the instance, and prefixing them would give one page as
many URLs as there are scopes. Their nav still shows the Project and Environment
groups, whose scope the shell resolves from the route, else the last scope this
browser was in (`utils/scope-memory.ts`, checked against what the server still
lists so a deleted environment cannot linger in the switcher), else the first the
server reports.

Leaving settings goes back to the resolved scope's workspace, from the nav
header — not to `/servers`, which would discard the project and environment you
were working in. Breadcrumbs link to their ancestors for the same reason.

`Routes.legacy` rewrites pre-restructure URLs — `/settings/general` to
`/settings/appearance`, `/settings/environments` to the project-scoped environment
list, a bare `/settings` to the project index, `/status` to
`/settings/connection` — so old links and bookmarks still land somewhere sensible. It runs in `App` before `Routes.parse`,
which knows nothing about the aliases.

## Layout

```
src/
  api/           ApiClient, ApiError, EntryMapper, DTOs under api/types/
  claims/        ClaimGroups (a claim set -> the sentences it means) and ClaimWords
  components/    Shared visual primitives: Button, Modal, Toast, Pill, Segmented, DataTable, ...
  forms/         The RJSF theme: templates/, widgets/, fields/, build-ui-schema.ts
  query/         FilterModel (the builder's flat model <-> the Query AST), UrlFilter, PathLabel
  router/        Routes, route types, the history store, Link
  schema/        SiloRefs, silo:// $ref resolution for RJSF
  styles/        The deliberately global CSS foundation
  utils/         Formatters, ThemeManager
  views/         Feature views with colocated *.module.css
    servers/     Server, project, and environment browser (the welcome screen)
    shell/       Sidebar and top bar
    entries/     Entries table, entry form, row actions, the filter builder
    search/      The Cmd-K palette, its result grouping, and snippet rendering
    schema/      Schema editor and builder
    keys/        Key list and creation
    media/       Media library
    plugins/     Plugin list, one plugin's grant/config/trail, and PluginGrantPlan
    transfer/    Export, import, and direct server copy
    settings/    The settings shell, its nav and scope switchers, and pages/
```

One exported artifact per file, matching the repository-wide convention. Files
target 100 to 150 lines, and each React component keeps its styles beside it.

`claims/` sits outside `views/` because two features render the same thing: the
key creation form and the plugin grant screen both turn a claim list into the
handful of sentences it actually means. A summary that silently drops a claim is
the one failure it cannot afford — that is exactly what happened to `hooks:`
claims between D34 and D40 — so anything with no words for it prints raw under
"Also" rather than not printing.

## Forms

Entry forms are generated from a collection's JSON Schema with
[RJSF](https://rjsf-team.github.io/react-jsonschema-form/) v6 and its ajv8
validator. `src/forms/` is a custom minimal theme rather than a component
library: `templates/` for field, object, title, description, and error list
rendering, `widgets/` for checkbox, select, textarea, tags, and media inputs,
and `fields/` for the raw JSON fallback.

Full JSON Schema is not fully renderable as a form. The policy is that RJSF
renders what it can and anything it cannot becomes a raw JSON editor for that
subtree. The server is authoritative either way: server-side validation errors
are mapped back onto the fields that caused them.

The same theme renders a **plugin's settings form** from the `config` schema in
its manifest, which `GET /api/plugins` carries. A plugin that declares no schema
falls back to a JSON editor, since a config silo cannot describe is still one an
operator may need to change. Either way the form edits a whole document and the
endpoint takes a delta, so what is sent is a `MergePatch.diff` against the config
in force — posting the edited document as the patch looks right and cannot
express a deletion.

`SiloRefs` (`src/schema/silo-refs.ts`) resolves `silo://collections/<name>`
references for the form layer. RJSF's renderer and validator only follow
internal pointers, so referenced collection schemas are inlined under `$defs`
and the references rewritten to `#/$defs/...`. Remote references, unknown
collections, and cycle-closing references become permissive marker nodes that
render as the raw JSON field, since the server remains authoritative for those.

Two RJSF v6 details worth remembering, both of which have caused real bugs here:

- A custom field's `onChange` signature is `(value, path, ...)`. Omit the path
  and the value is merged at the form data **root**.
- The top-level `formContext` prop was dropped from widgets and fields; it now
  lives at `registry.formContext`. `MediaWidget` reads it from there to get the
  server URL and key it needs to list and upload media.

## Styling

There is no component library and no runtime CSS-in-JS. Styling is design tokens
plus CSS Modules:

- Component and feature rules live in a `.module.css` beside the owning `.tsx`.
  Reach for an existing primitive in `components/` before adding a cross-feature
  selector.
- Globals are limited to `src/styles/`: `tokens.css`, `global.css`, `forms.css`,
  `layout.css`, `feedback.css`, and `utilities.css`. A new global selector
  should be a deliberately shared primitive, not a shortcut for one screen.
- Static presentation belongs in CSS. Inline `style` is reserved for values only
  known at runtime, such as a data table's schema-derived columns.
- Run `bun run lint` after styling changes. Stylelint catches invalid CSS,
  duplicate declarations, duplicate selectors, and duplicate keyframes.

Theme tokens include `--font-ui`, `--accent`, `--accent-soft`, `--accent-ink`,
`--panel`, `--text`, `--line`, and `--radius-sm`. `ThemeManager`
(`src/utils/theme-manager.ts`) persists the user's typography and accent choices
under `silo_appearance_settings` and applies them from `main.tsx` before the app
renders, so there is no flash of unstyled content. The Settings view's **General**
tab exposes curated Google Fonts, any Google Font by name, and accent presets
alongside a color picker.

## The shared package

Protocol rules that both the server and this app must agree on live in
`@silo/shared` (the repository's `shared/` directory): the claim catalog,
validation and matching, delegation, presets, the `HookName` vocabulary that hook
claims are validated and rendered against, `MergePatch` (RFC 7396),
`ValidationError` and its wire shape, the `silo://` reference scheme,
`x-silo-auth`, `x-silo-type: "media"`, and the API key display format. Import
from there rather than restating a rule locally, so the two sides cannot drift.

`ui/` is a member of the root Bun workspace and depends on the package through
`workspace:*`, so `node_modules/@silo/shared` is one symlink to the `shared/`
directory itself. Everything under it — including files added after the last
install — resolves immediately, and there is no separate install to run here:
`bun install` at the repository root covers this package too.

It was not always so. Under the `file:../shared` protocol Bun mirrored the
package as *per-file* symlinks, a snapshot taken at install time: edits to an
existing shared file propagated, but a newly added one was invisible until a
reinstall. TypeScript resolved new subpaths through the package's real path and
type-checked clean regardless, so the failure surfaced at bundle time as an
unresolved import rather than at `tsc`.

## Production build

```sh
bun run build       # writes ui/dist
```

`ui/dist` is git-ignored. The silo server serves it at `/` from its working
directory, and the Docker build compiles it in its own stage and copies the
result into the runtime image, so a container build needs no local `dist`.
