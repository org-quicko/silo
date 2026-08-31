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
6. **Media** — a searchable library: a folder rail, a name/type filter bound to the `_media` query, and per-asset rename, move, and delete. Assets (never folders) are multi-selectable — a checkbox on each card or row, a header checkbox in list view that selects the current page only — and a selection bar appears once anything is checked: a count, Clear, and Delete, shown only to a key holding `media:delete`. Selection clears on folder change, page change, query change, and after a successful delete. A single-file trash click and a multi-select delete are the same path — one list, sometimes of one — through `POST /api/media/delete` (D48). The flow is at most two dialogs: a confirm dialog first, and if the server refuses because something is still referenced, that dialog is replaced by one naming what is still in use, with the existing claim-filtered referrer list per file, an opt-in checkbox, and a Force delete button disabled until it is checked; checking it and forcing never opens a third dialog, and only the ids still refused are retried. Where the library *keeps* its bytes is a separate page under Settings → Media Library (D45), because it configures the instance rather than the content.
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
  Media Library                                  where uploads are stored, where their URLs point, what may be uploaded (D45, D46)
  Configuration                                  the rest of silo.toml: logging, search, validation, auth (D47)
  Plugins                                        every plugin with a record; one page each (D40)
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

**Media Library** sits under *Server* rather than under *Application*, and the
contrast with Appearance is the reason: Appearance is this browser's and never
leaves it, while this page is the **instance's** — it writes `silo.toml` and
takes effect on the running server (D45). It needs `media:configure`, which no
preset but root carries, and a key without it is told which claim is missing
rather than shown an empty form.

The page shows **two configurations**, and that is its whole shape. The form
holds what the *file* says; a read-only panel beside it holds what the server is
*using*, after environment variables and flags; and a field the file does not
decide carries a note naming the value in force and, where it can be known, the
variable supplying it. Both halves are needed for the page to be honest. Seeding
the form from what is in force would put the derived fs media path
(`<data dir>/media`, which is the value *precisely while nobody has named one*)
into a box and save it back as a literal, pinning media in place and breaking
`--data`. Hiding the environment would let somebody type a bucket, watch it
save, and see the instance keep using another one.

The provider list comes from the server (`drivers`), so a blob driver
contributed by a plugin is selectable without the admin holding a second copy of
the list, and whatever the file names stays in the select even when this build
can no longer open it — a select that dropped the current value would propose a
driver change nobody made. Which fields a provider shows follows the driver:
`fs` takes a directory, `s3` takes a bucket and a credential, and an unknown
driver takes both, because every driver is handed the same `[blob_storage]`
table and the admin cannot know which keys a plugin reads.

The secret is **write-only**, and its field is shaped by that. It is never read
back, so a stored one shows as a fixed-width mask in a box that will not take a
keystroke, and **clearing it is what opens the box** for a new value. Both
halves earn their place: an editable box holding a mask invites somebody to
append to a value they cannot see, and an empty box that quietly kept the old
secret reads as "not set" to everyone who did not write the page. An untouched
field sends nothing, a typed one wins over the clear that opened it, and saving
a cleared field empty is the only way to remove a credential. The endpoint's
placeholder is a self-hosted gateway rather than an AWS URL, since an
`s3.<region>.amazonaws.com` example above "leave empty for AWS" reads as an
instruction to fill it in. And the page
says plainly, beside the provider, that **existing files are not moved** —
switching provider leaves them where they are.

A **second card** below it holds the `[media]` table (D46): the base URL media
links are rooted at, whether that name fronts silo or the bucket, and the
extension allowlist as chips you add to and take from. It has its **own Save**,
because it writes its own table through its own route — a bucket that will not
open must not be able to hold up a correction to the allowlist, which is the one
thing an operator locked out of uploading needs to change. The allowlist is a
chip list rather than a comma-separated box because the value is a set and the
mistakes are per item: a stray space or a leading dot in one entry would refuse
that whole file type, and a chip makes each entry something you can see and
remove on its own. Its seeding is the deliberate opposite of the storage card's,
which takes every value from the file: an empty extension list is not a state
the server accepts, so the list falls back to what is **in force** when the file
names none. A box showing nothing while something is being enforced would be the
same page lying in the other direction.

**Configuration** is the same idea as Media Library, one page further out: the
rest of `silo.toml`, one card and one Save per table (D47). Its cards are drawn
from a **spec the server sends** rather than from a field list written out here,
so a setting added to `ConfigSections` appears with its label, its type and its
restart behaviour intact. A form built from a second copy of that list goes
stale one release after somebody adds a field to only one of them.

Its difference from every other settings page is the one an operator has to
trust: **not everything applies immediately.** A log level is read on every line
and takes effect at once; a tokenizer rebuilds an index at boot and a log file is
a handle opened once. So each field says which it is, and a saved value the
process has not adopted is reported as *waiting for a restart* and kept out of
what the page calls in force — echoing it back would be worst exactly where it
hurts most, since `[log] file` is what somebody reads when they are already lost.
Two cards are deliberately less than editable: `[storage]` is reported and never
written, because changing it names a different instance rather than configuring
this one, and `[auth] disabled` offers only the direction that turns
authentication back on.

**Appearance** is client-only state — `ThemeManager` persists it to `localStorage`, never to a server, so the choice follows the browser rather than the instance. Three things compose: a **colour mode** (light/dark/system, the last resolved live against `prefers-color-scheme`), a **theme** (an accent paired with the sidebar tint it was designed alongside — `--sidebar`/`--sidebar-hover`, distinct from the main content's `--panel`/`--panel-2` so a theme can read as more than a hue swap), and a **font**. Dark mode's per-theme sidebar hex applies as-is; light mode instead washes the sidebar from whatever accent is active, because hand-tuning a light-mode pair for every theme would double the palette for no visual gain light mode doesn't already get by deriving it. Picking a custom accent hex keeps the last theme's sidebar and labels the bundle `Custom`, matching how picking a font or a mode leaves the other two alone. The theme gallery groups **Featured** (duotone hero bundles), **Single colour**, and **Vision assistive** (colour-blind-safe accent/sidebar pairs) — the grouping is presentation only, every entry is the same `ThemePreset` shape.

## 10. Plugin panels (D41)

A plugin may ship its own screen. `contributes.ui` names one inlined HTML file,
and `PluginPanelCard` renders it on that plugin's page, below the summary of what
the plugin is allowed to do. It used to sit below the grant, the route list and
the config *open* on the page, on the argument that a panel is a screen for
spending whatever the plugin was granted, so an operator who scrolls to it has
already read what that is. The order was right and the cost was wrong; §10a is
what replaced it.

It is fetched only when opened. It is third-party markup measured in kilobytes,
and an operator who came here to revoke a grant should not have the package's own
screen render itself on the way — a `needs_review` plugin being exactly the case
where that is least welcome.

**The isolation is the feature, and it is three attributes.** The iframe is
`sandbox="allow-scripts"` with **no** `allow-same-origin`, mounted through
`srcdoc` and never `src`. That gives the panel an opaque origin, which matters
concretely rather than theoretically: this app keeps `silo_servers` in
`localStorage`, holding an API key for **every** instance the operator has
configured, so a panel with same-origin access would hold more authority than any
plugin can be granted. Identity is established by comparing `event.source` with
the frame's own `contentWindow`, because an opaque origin posts as `"null"` and
every sandboxed frame on the page shares that.

A panel's one capability is asking this app to call **its own plugin's** routes,
with the operator's key. `plugin-panel-protocol.ts` is that boundary and nothing
else is — it is pure, and tested without a DOM, because a security check that
needs a browser to exercise is one nobody exercises. `plugin-panel-preamble.ts`
generates the other half: a `window.silo` client over `postMessage`, and the
admin's own resolved theme tokens as CSS custom properties, so a panel follows a
custom accent or light mode without knowing which is on. Both are generated here
rather than left to plugin authors, which is what makes the wire format a
contract with one client instead of a convention with many.

Theme tokens are read once per mount rather than per render: rebuilding `srcdoc`
reloads the panel, which would lose whatever the operator had typed into it. A
theme change therefore does not retint an open panel — the right trade, since
reloading a form under somebody's hands to correct a colour is worse than the
colour. Height is a request the panel makes and this app clamps, because an
unclamped one could push every other card off the screen, including the grant that
would let an operator turn it off. A panel with more to show than the clamp allows
takes **full screen** instead, where it gets the viewport and scrolls inside
itself rather than growing the page under it. §13.20 in
[plugins.md](plugins.md) has the contract.

**Measuring a panel is three mistakes deep, and D44 fixed them.** The panel posts
a height and the admin clamps it, so the measurement has to be of the *content*:
`documentElement.scrollHeight` is at least the viewport, which is the height the
admin just granted, so measuring it reported back whatever was last asked for and
a panel could only ever grow — content that collapsed left a band of the frame's
own canvas below it. It measures `document.body` now. That canvas was **white**,
because a frame's base colour is white and a transparent document does not reveal
what is behind the frame but that, so the panel document paints `html` with the
admin's own `--panel`. And the `ResizeObserver` was created without being
retained, so it was collectable and stopped reporting with no sign that it had,
which a panel rendering after a fetch — most of them — hit every time. A zero
measurement is retried on a timer rather than reported: a sandboxed frame reports
zero at `DOMContentLoaded` *and* at `load`, because an opaque-origin frame has not
been through a rendering lifecycle by then, and a timer runs where a frame
callback does not.

## 10a. One plugin's page (D44)

Four sections — the grant, the routes, the config, the trail — used to be open on
that page at once. Measured on a real package that is eight claims, eleven routes,
a generated form and an audit trail, stacked above the panel, so an operator
arriving to *use* a plugin scrolled past all of it. Each is now a right-hand
`Sheet`, and what stays on the page is the button that opens it, carrying **that
section's state**: `4 of 8 claims`, `11 routes · 2 public`, `overridden here`,
warn-toned when something is outstanding. That is the constraint the split had to
respect: D40's property is that this page answers *is anything waiting on me*
without being opened, so the decision moved behind a click and the fact that there
is one to make did not.

`Sheet` is the second overlay in this app and answers a different question from
`Modal`. A modal asks something: small, centred, two buttons, one answer. A sheet
holds a section of the page you were already on: tall, scrolling, no single
answer. The body is the only thing that scrolls, because a section tall enough to
need the whole viewport is what moved these off the page to begin with.

Uninstalling lives on this page and nowhere else, behind a typed-name
`DangerConfirm`, which is the same rule projects and environments are held to:
reserved for actions no undo exists for. It qualifies twice, since the package
leaves the disk and the grant leaves with it. Not a row action in the list, for
the same reason deleting a project is not.
