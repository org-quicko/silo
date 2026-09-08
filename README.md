# silo

A small, standards-based headless CMS. Define your collections in JSON Schema.
You get an admin UI with generated forms, a REST API, and data you can move
anywhere.

silo is one TypeScript process on [Bun](https://bun.com), with six runtime
dependencies. It keeps content as plain JSON documents in SQLite or in flat
files, it serves its own React admin UI, and each moving part sits behind an
interface you can replace. There is no proprietary field language, query
language, or file format in it. What silo stores, your other tools can already
read.

## Quick start

### Homebrew

```sh
brew install org-quicko/tap/silo
silo serve
```

`brew services start silo` runs silo in the background instead. It keeps the
data in `$(brew --prefix)/var/silo`.

### dnf (Amazon Linux 2023, RHEL, Fedora)

```sh
sudo curl -fsSL -o /etc/yum.repos.d/silo.repo https://org-quicko.github.io/silo/silo.repo
sudo dnf install silo
sudo systemctl enable --now silo
```

The package adds a `silo` system user, a config file at `/etc/silo/silo.toml`, a
data directory at `/var/lib/silo`, and a systemd unit. Nothing starts on
install. Both the packages and the repository index are signed, and the `.repo`
file makes dnf verify each of them.

### Docker

```sh
docker build --pull -t silo .
docker run -p 8090:8090 -v silo_data:/data silo
```

### Prebuilt binaries

Each [release](https://github.com/org-quicko/silo/releases) has an archive for
macOS and Linux, on x64 and arm64. Each archive holds one self-contained `silo`
with the admin UI inside the executable, so the whole installation is to put it
on your `PATH`. Releases carry a `SHA256SUMS` file with two signatures over it:
Sigstore keyless, and GPG.

### From source

Requires Bun 1.3 or later.

```sh
bun install
bun run --cwd apps/admin build
bun run start
```

From source, the server reads the admin UI from `./apps/admin/dist`. Skip that
build if you want the API only. A released binary has the UI inside it, and
serves it from any working directory.

### First run

On the first start of an empty instance, silo makes a root API key and prints it
one time, to the console. Store it. You need it to connect the admin UI.

Open <http://localhost:8090>, add the server with its URL and that key, and you
can create a collection, fill in a generated form, add entries, mint more keys,
upload media, and move data between instances.

If you lose every key, mint a new one against the data directory. No server has
to be running:

```sh
silo keys create --preset root --label recovery
```

## Concepts

| Term | What it is |
|------|------------|
| **Instance** | One data directory with one `instance_id`. Everything below is inside it. |
| **Project** | A named container, for example a tenant or an application. |
| **Environment** | A named container inside a project, for example `prod` or `staging`. |
| **Collection** | A name and a JSON Schema document, identified by `(project, environment, name)`. |
| **Entry** | A JSON document in a silo envelope: a ULID `id`, a `rev`, a `seq`, and UTC timestamps. |
| **Variable** | A name declared once in a project, valued per environment, and put into each `{{NAME}}` an entry holds. |
| **API key** | A key with explicit claims. silo has no users and no sessions. |

Projects and environments are plain string containers with no metadata of their
own. All three of projects, environments and collections are keyed records, so
you can rename any of them, and the claims that name them follow.

Entries are documents. silo does not map a schema to tables. It validates a
schema on write only, so a schema change never rewrites or blocks the entries
that already exist. The admin UI marks an entry that predates the change when
you open it.

Names that start with `_` belong to silo. API keys, for example, live in the
reserved `_system/_system` scope as a `_keys` collection. silo stores them
exactly like your own content, which is why every storage driver and the export
engine handle them with no special code.

## Features

- **One process, one data directory.** No database server, no cache, no queue,
  and no search cluster. SQLite comes from the runtime. Media goes to local disk
  by default. The server hosts the admin UI itself, and compiles to a
  standalone binary.
- **Standard formats.** [JSON Schema draft 2020-12](https://json-schema.org/specification)
  for collections, validated in full by Ajv 2020. Plain JSON for entries. REST
  over HTTP for transport. ULIDs for ids, RFC 3339 UTC for timestamps, tarballs
  for archives, the S3 API for media, and TOML plus environment variables for
  configuration.
- **Generated admin UI.** The admin reads a collection's schema and draws the
  form. A construct no form can draw becomes a raw JSON editor for that part
  only. `x-silo-*` keywords in a schema control how the admin renders and
  protects a collection.
- **Search and filters.** Text search at three reaches: one collection, one
  environment, or everything the key can read. The filter is a small JSON AST
  over [RFC 9535](https://www.rfc-editor.org/rfc/rfc9535) JSONPath, and the
  admin's filter builder writes that same AST. All of it goes in the URL, so a
  filtered view is a link you can send.
- **Claims, not roles.** An API key carries explicit claims, with a wildcard
  available per segment. Access is deny by default, and a key can mint only keys
  its own claims already cover.
- **Safe concurrent writes.** `PUT` and `DELETE` on an entry take the revision
  you expect, as `If-Match`. A mismatch is a `409`, so two admin tabs cannot
  overwrite each other in silence.
- **A media library.** Local disk, or any S3-compatible bucket. Folders, tags, a
  type filter, and a check that refuses to delete an asset an entry still
  references. Where the library keeps its bytes is configurable from the admin.
- **Per-environment values.** A variable holds the one string that has to differ
  between `staging` and `prod`. Declare the name once in the project, value it
  in each environment, and silo puts the value into each `{{NAME}}` on the way
  out.
- **Portable data.** One command exports every project, environment, schema,
  entry, and media file, and one command imports it again. The filesystem
  driver's on-disk layout is the export format, so an fs-backed instance is a
  live backup you can copy with `cp`, replicate with `rsync`, or review in git.
  You can also pull an export straight from another running silo.
- **Replaceable parts.** Storage is SQLite, flat files, or your own driver.
  Media is local disk or any S3-compatible bucket (AWS S3, MinIO, Cloudflare R2,
  DigitalOcean Spaces). The admin UI is an ordinary client of the public API, so
  you can extend it, fork it, or write your own.

## Plugins

A plugin is a directory in `<data dir>/plugins/` that silo loads because
`silo.toml` names it. A plugin needs no build step, because silo transpiles
TypeScript itself, and it needs no dependencies at all. silo injects a virtual
`silo:api` module into the plugin before it loads.

```sh
npm create silo-plugin           # scaffold one
silo add ./my-plugin             # or a .tgz, an npm package, a URL, a git repo
silo plugin grant my-plugin      # approve what its manifest asks for
```

A package declares what it contributes, and it can contribute more than one
thing:

| Contribution | What it does |
|--------------|--------------|
| `hooks` | Reacts to the entry and collection lifecycle |
| `routes` | Serves HTTP under `/api/ext/<name>/` |
| `runtime` | Runs `activate(ctx)` at startup, and `deactivate(ctx)` on the way out |
| `ui` | Ships an admin panel, drawn in a sandboxed frame with no origin |
| `providers` | Implements the storage or blob-storage port, and adds a driver name |

**A plugin is an API key with code attached.** It never receives the database or
the service. It acts through `ctx`, and each `ctx` call is a request against
silo's own HTTP API, with the same routes, guards and answers a key with those
claims would get. A manifest requests claims, and an operator grants them, under
**Settings > Plugins** or with `silo plugin grant`. A grant is live: narrow it or
withdraw it, and the next call is refused with no restart.

The trust boundary is the act of installation, as it is for an npm package or a
VS Code extension. A worker bounds faults, not malice, so read a plugin before
you install it. `silo add` runs none of the package's code and no lifecycle
script.

Two first-party plugins live in this repository. They use the same contract a
third-party package uses, and neither is bundled or enabled for you:

- [silo-plugin-observability](plugins/silo-plugin-observability): API traffic,
  errors, latency, process memory and CPU, and storage use.
- [silo-plugin-strapi-import](plugins/silo-plugin-strapi-import): imports a
  Strapi 5 SQLite export into silo collections, with the media.

Full guide: [docs/guide/plugins.md](docs/guide/plugins.md).

## Deployment

Run silo in the **foreground**, and let Docker, systemd, or another supervisor
own the process, its restarts, and its output. `--detach` is for bare metal and
development, where `silo status`, `silo logs` and `silo stop` manage the
background server.

The Docker image runs as the unprivileged `bun` user. Mount a volume at `/data`,
which holds the SQLite database, the uploads, and `silo.toml`. Without that
volume, each deployment starts on an empty data directory and prints a new root
key. A `HEALTHCHECK` on `GET /api/health` is built in.

For systemd, keep the default `Type=simple`, do not add `--detach`, and leave
`[log] file` unset so `journalctl -u silo` has everything.

Several silos on one machine are fine. Give each one its own data directory and
its own port. Two processes over one data directory is refused, and
[docs/guide/deployment.md](docs/guide/deployment.md) explains why.

## Documentation

| Guide | What it covers |
|-------|----------------|
| [Configuration](docs/guide/configuration.md) | `silo.toml`, the `SILO_*` variables, and running as a service |
| [CLI](docs/guide/cli.md) | Every subcommand and every flag |
| [HTTP API](docs/guide/http-api.md) | The routes, the query AST, search, and the error shape |
| [Authentication and claims](docs/guide/claims.md) | The claim catalog, wildcards, and delegation |
| [Plugins](docs/guide/plugins.md) | Write one, enable one, install one, inspect one |
| [Export, import and copy](docs/guide/transfer.md) | Archives, the on-disk layout, and migration |
| [Deployment](docs/guide/deployment.md) | Docker, systemd, and volumes |
| [Admin UI](apps/admin/README.md) | The admin app, and how to work on it |

`docs/design/` holds the rationale: why an interface has the shape it has, and
what each decision cost.

## Development

```sh
bun install
bun test          # server, shared, and the storage conformance suites
bun run dev       # the server and the admin UI together
bun run build     # the single-file binary, with the UI inside it
```

An empty instance hides most of what the admin UI does, so there is a seeder. It
fills a running server over the public HTTP API with about 5,000 entries, across
two projects with three environments each:

```sh
bun run seed --key "$SILO_KEY"
```

| Path | What it is |
|------|------------|
| `apps/server/` | The Bun and Hono backend: core, adapters, HTTP, CLI, config, plugin host, tests |
| `apps/admin/` | The React and Vite admin UI |
| `packages/shared/` | `@silo/shared`, the rules both the server and the UI depend on |
| `packages/create-silo-plugin/` | The plugin scaffolder, published to npm |
| `plugins/` | First-party plugins, one workspace package each |
| `tools/` | Build, packaging, seed and version tooling, run through `bun run` |
| `packaging/` | The Homebrew formula, and the dnf package with its systemd unit |
| `docs/` | `guide/` to use silo, `design/` for the rationale, `context/` for the current state |

The architecture is ports and adapters. `apps/server/src/core/` holds the domain
types and the `Storage` and `BlobStorage` interfaces, and imports no adapter.
Adapters implement those interfaces, and the CLI wires everything from config.
The testing spine is the storage conformance suite in
`apps/server/test/conformance/`, which runs against both drivers, plus the
export and import round-trip tests. Both drivers must give the same answers,
and that is what keeps migration between them honest.

## Contributing

Issues and pull requests are welcome at <https://github.com/org-quicko/silo>.

- `bun test` must pass before a change lands, and a change in behaviour comes
  with the test that covers it.
- Anything that touches storage belongs in the conformance suite, so both
  drivers are held to one answer.
- Open an issue before you build something structural: a new port, a change to
  the claim grammar, or a change to the on-disk layout. That layout is a frozen
  public format and moves only with a `format_version` bump, so those proposals
  are worth agreement before the code exists.

Read [docs/context/code-design.md](docs/context/code-design.md) first. It is
short: one artifact per file, short files, full names, and the rationale in
`docs/` instead of in comments.

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE).
