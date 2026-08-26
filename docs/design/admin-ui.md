# Admin UI

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 9. Admin UI

React + TypeScript + Vite + RJSF (`@rjsf/core` + `@rjsf/validator-ajv8` for 2020-12), built to `apps/admin/dist`, embedded into the executable through Bun's file imports (D26). The build compiles the UI first; the released binary is self-contained, and serves the UI from whatever directory it is run in.

**Design principle: minimal and clean.** No heavy component library or runtime CSS-in-JS — a small global token/reset/primitives foundation, colocated CSS Modules, shared React visual primitives, and a custom minimal RJSF theme. No dashboard chrome, no charts, fast first load.

**Layout:** a server manager, then a two-pane shell, with settings as a second two-pane shell of its own:

- **Sidebar (nav):** a `⌘K` search trigger, then the visible collections with an in-memory box that *filters what is already listed* — a different question from the palette's, so the two are worded apart — and user-resizable width (persisted in `localStorage`); selecting one shows its entries. Pinned at the bottom when authorized: *Keys*, *Media*, and *Data transfer*. Navigation and page actions adapt to the session's claims.
- **Top bar (slim):** breadcrumbs for the current page, its actions, and a session pill stating what the active key can do **in the scope on screen** (full access / read & write / read-only / none), derived from its claims by `Claims.accessLevel`. The key's own label and prefix are the pill's tooltip; the instance name and the lock live in the sidebar's scope switcher, so the top bar does not repeat them.
- **Main pane:** whatever the nav selected.

**Views:**

1. **Server manager** — the welcome screen: pick a saved silo instance or add one (name, URL, API key), with the URL and key verified against `GET /api/session` before the server is saved. Shown on first visit and after any `401`.
2. **Entries list** (default main view) — table per collection, columns derived from top-level schema properties, sort/paginate via the list API, *New entry* button. Text runs the collection-reach `/search` (D30) rather than a `contains` on one column: results carry snippets naming the field each match came from, and the engine that answered is stated. A **filter builder** writes the Query AST (D29) over the schema's own fields, offering only the ops `@silo/shared` declares and only paths `JsonPath` can build; the AST travels in the URL as raw JSON, so a filtered view is linkable, and one it cannot draw — nesting, `not`, a hand-written filter — is shown read-only and still applied rather than quietly simplified. Everything on screen lives in the URL. **An absent `sort` means nobody chose one**, which is what lets a search rank by relevance and a listing fall back to newest-first; writing the default out would pin the view to a date order no search could override.
3. **Command palette** (`⌘K`) — instance-wide search from anywhere in the shell. It asks for the whole instance rather than the scope on screen because the key already bounds it (`searchAccess`), groups hits by collection in the order the ranking gave, names the `project/env` only for results outside the current scope, and merges media in as its own group — the one place the two result sets meet.
4. **Entry form** — RJSF-generated from the schema; per-subtree raw-JSON fallback for unrenderable constructs (D3); server validation errors mapped back onto fields.
5. **Schema editor** — create/edit a collection's JSON Schema in a JSON editor (CodeMirror) with live validation of the schema document itself.
6. **Media** — a searchable library: a folder rail, a name/type filter bound to the `_media` query, and per-asset rename, move, and delete. An asset in use shows its reference count and refuses deletion, naming the entries the current key may read (§8.1).
7. **Keys** — list (label, claims, prefix, created), revoke, and a dedicated creation page. Revoke is offered only for keys the current one could have minted (D37) and never for a plugin's managed key (D34), because the route refuses both. The creation page is one guided sentence: a label, a **reach** naming the project and env segments of the key's collection claims independently (one env · a whole project · one env across every project · the whole instance), and a **role** (`read` · `write` · `manage` · `root`). One Advanced disclosure adds what the sentence cannot say — narrowing to named collections, the instance capabilities (media, key management, transfer), and a raw claim editor that takes over from the guided controls when even those are not enough. Choosing a transfer capability composes in the instance-wide collection permissions D21 requires alongside it, rather than naming them in help text. Options the current key cannot delegate are disabled with the reason. The secret is shown once. Plugin management and the audit trail are capabilities here too (D38); an instance capability this page has no words for is still shown, flagged, rather than omitted from the summary — a claim set that renders as less than it grants is the one failure a pre-mint summary cannot afford.
8. **Data transfer** — two pages at two blast radii. Under *Server*: claim-aware whole-instance export/import panels and direct copy from another running silo (merge/replace, data-only/data-plus-keys). Under *Environment*: copy from another environment of this instance (D22), preview-then-apply, gated on the scoped claims the copy exercises.
9. **Settings** — a nav column grouped by the scope each page configures; see below.

**Settings** is divided by the scope each page configures, because a collection is
identified by `(project, env, collection)` (D18–D20) and most of what settings
configures therefore belongs to a particular project or environment rather than
to the server. Three nav groups, with a context switcher heading each nested
block:

```
SERVER
  API Keys                                       list, revoke, and a creation page
  Data Transfer                                  whole-instance archive and direct server copy
  Connection                                     endpoint, live diagnostics, forget this server
PROJECTS
  Projects                                       every project on the instance, and creating one
    [ project switcher ▾ · New project ]
    General                                      id, environment count, delete behind a typed-name confirmation
    Environments                                 this project's environments, and creating one
      [ environment switcher ▾ · New environment ]
      General                                    scope, collections, open workspace, delete behind a typed-name confirmation
      Data Transfer                              copy from another environment (D22)
APPLICATION
  Appearance                                     colour mode, theme, fonts, accent
```

| Group | URL |
|---|---|
| Server | `/servers/:sid/settings/:section` |
| Projects (index) | `/servers/:sid/settings/projects` |
| One project | `/servers/:sid/projects/:project/settings/:section` |
| One environment | `/servers/:sid/projects/:project/environments/:env/settings/:section` |
| Application | `/servers/:sid/settings/appearance` |

Groups run outside-in — the server that hosts everything, the projects it holds,
then this browser — and scope **nests** rather than forming peer groups: one
project's pages hang off the project index, one environment's off that project's
environment list. Both nested blocks start collapsed and open when the route
enters them. Projects and Environments are indexes: a row opens that item's own
page, and deleting lives only there, behind a typed-name confirmation, rather
than as a button in a list.

The scope prefix is identical to the workspace routes and to the HTTP API's
`/api/projects/{project}/environments/{env}/…`, with `settings` as the tail, so a
workspace URL becomes its settings URL by swapping that tail. Server-level pages
deliberately take **no** scope prefix — a key or a connection belongs to the
instance, and prefixing them would let one page be bookmarked at as many URLs as
there are scopes. The nested project and environment rows still need a scope to
point at while such a page is open: the shell resolves one from the route, else
the last this browser was in (`ScopeMemory`, validated against what the server
still lists), else the first the server reports. Pre-restructure URLs are rewritten to their replacement by
`Routes.legacy`.

The nav header is the way back **into the workspace** at the resolved scope,
not out to the server gate — settings is a detour, and leaving it should not cost
you the project and environment you were working in. The gate stays reachable
from a smaller control beside it, and ancestor breadcrumbs link upward.

Deleting a project or an environment is irreversible and takes everything under
it, so both are gated on typing the id back (`DangerConfirm`). Forgetting a saved
server connection is not — it destroys nothing on the instance — and takes a
plain confirmation.

`x-silo-ui` extension keys map to RJSF `uiSchema` (widget selection, field order, help text).

**Appearance** is client-only state — `ThemeManager` persists it to `localStorage`, never to a server, so the choice follows the browser rather than the instance. Three things compose: a **colour mode** (light/dark/system, the last resolved live against `prefers-color-scheme`), a **theme** (an accent paired with the sidebar tint it was designed alongside — `--sidebar`/`--sidebar-hover`, distinct from the main content's `--panel`/`--panel-2` so a theme can read as more than a hue swap), and a **font**. Dark mode's per-theme sidebar hex applies as-is; light mode instead washes the sidebar from whatever accent is active, because hand-tuning a light-mode pair for every theme would double the palette for no visual gain light mode doesn't already get by deriving it. Picking a custom accent hex keeps the last theme's sidebar and labels the bundle `Custom`, matching how picking a font or a mode leaves the other two alone. The theme gallery groups **Featured** (duotone hero bundles), **Single colour**, and **Vision assistive** (colour-blind-safe accent/sidebar pairs) — the grouping is presentation only, every entry is the same `ThemePreset` shape.
