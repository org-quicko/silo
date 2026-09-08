# silo admin UI

The admin interface for [silo](../../README.md). It is a React and TypeScript
single-page app, built with Vite, and it talks to any silo instance over the
public REST API.

The app is a client of that API, not a privileged part of the server. It keeps a
list of servers in `localStorage`, so one build can administer several
instances, including instances it was not served from. In production the silo
server serves the compiled bundle from `apps/admin/dist` at `/`, with an SPA
fallback.

## Quick start

Requires Bun 1.3 or later, and a silo backend to point at.

```sh
bun install                       # from the repository root
bun run dev                       # the server and this app together
```

To run this app on its own, against a backend that is already up:

```sh
bun run --cwd apps/admin dev
```

Open the Vite dev server and add your backend on the welcome screen: a name, a
URL such as `http://localhost:8090`, and an API key. The app checks the pair
against `GET /api/session` before it saves them. There is no dev proxy, and none
is needed. The backend enables CORS on `/api/*`, and each request goes to the
saved absolute URL.

## Scripts

| Command | What it does |
|---------|--------------|
| `bun run dev` | Vite dev server, with hot module replacement |
| `bun run build` | Type-check the project references, then build to `apps/admin/dist` |
| `bun run preview` | Serve the production build locally |
| `bun run lint` | `lint:ts`, then `lint:css` |
| `bun run lint:ts` | oxlint, configured in `.oxlintrc.json` |
| `bun run lint:css` | stylelint over `src/**/*.css`, configured in `stylelint.config.mjs` |

`apps/admin/dist` is git-ignored. The Docker build compiles the app in its own
stage, and the release build puts it inside the binary, so neither needs a local
`dist`.

## Layout

```
src/
  api/           SiloApi, one client per resource, one transport, the DTOs
  claims/        A claim set turned into the sentences it means
  components/    Shared primitives: modal/, buttons/, feedback/, data/, brand/, controls/, navigation/
  forms/         The RJSF theme: templates/, widgets/, fields/, and the {{NAME}} affordance
  query/         FilterModel, the Query AST round trip, and path labels
  router/        The route table, the history store, and Link
  schema/        silo:// reference resolution, and the schema builder's model
  store/         Server state, read stale-while-revalidate, with a hook per resource
  styles/        The intentionally global CSS foundation
  utils/         Formatters, ThemeManager, scope and scroll memory
  views/         One directory per feature, with colocated *.module.css
```

Where each file sits and what it holds is in
[docs/context/repo-map.md](../../docs/context/repo-map.md). The reasons behind
the shapes are in [docs/design/admin-ui.md](../../docs/design/admin-ui.md).

## How it works

- **One place speaks HTTP.** `api/transport/http-transport.ts` makes every
  request. Each call takes the target server's URL and key, and sends
  `Authorization: Bearer <key>`, so nothing depends on being hosted by the
  instance it administers. A refusal arrives as an `ApiError` with the status,
  the server's error code, and any validation details, which the entry form maps
  back onto the fields that caused them.
- **Saved servers live in `localStorage`**, under `silo_servers`, with the last
  connected one under `silo_active_server_id`. A key can be revoked while a tab
  is open, so any `401` clears the active server and returns to the server list.
- **The URL is the source of truth** for what is on screen. Each workspace URL
  carries its server, project and environment, and the entry list keeps its
  text, filter, sort and page in the query string. A searched, filtered, sorted
  view is therefore a link you can send. `src/router/routes.ts` owns both
  building and parsing, so the grammar lives in one file.
- **Claims decide what is visible.** `GET /api/session` reports what the current
  key can do, and an action it cannot perform is hidden or disabled instead of
  failing on click.
- **Server state lives in the store.** A screen opened before draws from what it
  already had, while the same request goes out behind it.
- **Forms are generated**, from a collection's JSON Schema with
  [RJSF](https://rjsf-team.github.io/react-jsonschema-form/) v6 and its ajv8
  validator. `src/forms/` is a small custom theme, not a component library. RJSF
  draws what it can, and anything it cannot becomes a raw JSON editor for that
  part of the document. The server stays authoritative either way. The same
  theme draws a plugin's settings form from the `config` schema in its manifest.
- **Styling is design tokens plus CSS Modules.** There is no component library
  and no runtime CSS-in-JS. Component rules go in a `.module.css` beside the
  owning `.tsx`, and globals stay in `src/styles/`. Run `bun run lint` after any
  styling change.

## The shared package

Rules both the server and this app must agree on live in `@silo/shared`
([packages/shared](../../packages/shared)): the claim catalog, delegation,
presets, the hook vocabulary, `MergePatch` (RFC 7396), `ValidationError` and its
wire shape, the `silo://` reference scheme, `x-silo-auth`,
`x-silo-type: "media"`, and the API key format. Import a rule from there instead
of restating it here, so the two sides cannot drift.

`apps/admin` is a member of the root Bun workspace and depends on the package
through `workspace:*`, so `node_modules/@silo/shared` is one symlink to
`packages/shared`. Everything under it resolves at once, new files included, and
`bun install` at the repository root covers this package too.
