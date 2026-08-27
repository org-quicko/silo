# create-silo-plugin

Scaffold a [silo](https://github.com/org-quicko/silo) plugin — the manifest, a
runnable stub per hook, and the `silo:api` type declarations — in one command.

```sh
npm create silo-plugin
```

```sh
bun create silo-plugin silo-plugin-slugs
```

Run it with no arguments to be asked. Every question has a flag, and every flag
skips its question, so `--yes` with the flags you care about is a scripted
scaffold that asks nothing.

## What it writes

```
silo-plugin-slugs/
├── package.json      the manifest — silo reads package.json#silo without running anything
├── index.ts          your plugin: no build step, no dependencies
├── panel.html        --panel only: the screen the admin renders, in a sandboxed frame
├── silo-api.d.ts     types for the silo:api virtual module (contributes nothing at runtime)
├── tsconfig.json     editor support only
├── README.md         where the directory goes, and the [[plugins]] block to paste
└── .gitignore
```

Then three steps the tool prints for you, because a scaffolded directory is
inert until it is *placed* and *named*:

```sh
cp -r silo-plugin-slugs <data dir>/plugins/silo-plugin-slugs
```

```toml
[[plugins]]
name       = "silo-plugin-slugs"
claims     = []
timeout_ms = 5000
on_error   = "fail"

  [plugins.config]
  collection = "posts"
```

```sh
silo plugin doctor
```

## Why it exists

A silo plugin has no installer, no registry and no dependencies: it is a
directory you place under your data dir and name in `silo.toml`. That is a good
deal, and it leaves exactly three things to get wrong the first time, all of
which refuse the start rather than degrading:

- **The manifest.** `package.json#silo` is static so `silo plugin info` can show
  an operator what a package wants before any of its code runs. A missing hook
  declaration, a claim the operator did not grant, a `silo` range that excludes
  the running build — each is a refused start.
- **`silo:api`.** It is a virtual module with no file on disk and nothing on
  npm; silo injects it into the plugin's import graph before the plugin loads.
  That is what makes a plugin dependency-free, and it means an editor needs a
  `.d.ts` copied next to the plugin to resolve the import. This tool ships that
  copy, verified byte-identical to silo's own in silo's test suite.
- **Which hook may do what.** `entry.beforeValidate` may rewrite `data`;
  everything after validation may reject but not rewrite. The generated stubs
  are written the right way round, with the reason in a comment.

## Options

| Flag | |
|------|--|
| `--name <name>` | npm package name; also how `[[plugins]] name` addresses it |
| `-d, --dir <path>` | where to write it (default: the name, unscoped) |
| `--kind <kind>` | `extension` or `provider` (default: `extension`) |
| `--hooks <a,b>` | extension only, comma-separated; `""` for none |
| `--routes <a,b>` | `"GET /status, POST /source+bytes:64"` — see below |
| `--runtime` | export `activate(ctx)` / `deactivate(ctx)` |
| `--panel` | ship `panel.html` and declare `silo.contributes.ui` |
| `--claims <a,b>` | what the manifest requests (default: none) |
| `--port <port>` | provider only: `storage` or `blob` |
| `--driver <name>` | provider only: the driver name `silo.toml` selects |
| `--silo <range>` | version range of silo the plugin supports |
| `--config` / `--no-config` | emit a config schema (extensions; on by default) |
| `-y, --yes` | take every default, ask nothing |
| `-f, --force` | write into a non-empty directory |

### Routes, and `+bytes`

A route is `"<METHOD> </path>"`, with `:params` and no wildcards, served under
`/api/ext/<name>/` behind the `http:route` claim — which the generated
`[[plugins]]` block grants, because a plugin whose every route answers 403 is
running, healthy, and not doing what it was installed for.

```sh
--routes "GET /status, GET /notes/:id, DELETE /notes/:id"
```

Append `+bytes` to a route that receives a **file**, and the payload arrives
undecoded in `request.bytes` instead of `request.body`:

```sh
--routes "POST /source+bytes:64"
```

The size is in MiB, up to silo's ceiling of 64. It is declared in the manifest
rather than assumed, because it is how much the host will allocate for whoever
reaches that route — so an operator sees the number beside the route when they
approve it, and it joins the manifest digest, so raising it in a later release
asks them again.

### Panels

`--panel` writes `panel.html` and declares it. The admin renders it inside an
iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, so a panel has
no origin of its own: it cannot read the admin's stored API keys, and nothing it
fetches carries a credential.

Its one capability is `window.silo`, which the admin injects. `silo.fetch(path)`
and `silo.json(path)` ask the admin to call **your plugin's own routes** — nothing
else — with the operator's key. So a panel spends the operator's authority over
your routes, and your handlers spend the plugin's grant; both halves are approved
and neither is implicit.

There is no static asset server: a panel is one inlined file, so its CSS and its
script go in it. The admin's theme arrives as CSS custom properties, so
`var(--text)` and `var(--accent)` follow whatever the operator has on.

### The `silo` range

The generated manifest declares a range against silo's version, and that one
comparison is the whole compatibility gate — there is no separate plugin API
version. The default is derived from **this package's version**, which tracks
silo's release for release: `create-silo-plugin@0.2.x` writes `"silo": "^0.2"`,
and the release that makes silo 1.0.0 writes `"silo": "^1"`. Pass `--silo` to
target something else.

## Development

Zero runtime dependencies, by design — the same property the plugins it emits
have, and the reason it runs under `npx` against a silo it was never installed
beside.

```sh
bun install
bun run typecheck
bun run build      # dist/cli.js, Node-compatible
```

It lives in the silo repository so its copies of silo's contract can be checked
against the originals: `apps/server/test/plugins/create-silo-plugin-drift.test.ts`
fails silo's own suite the moment a hook, a reserved driver name, a provider
port, a route method, the byte-body ceiling or the `silo:api` declarations
diverge.

## Licence

AGPL-3.0-or-later, like silo. The plugins it generates carry no licence of their
own — that is yours to choose.
