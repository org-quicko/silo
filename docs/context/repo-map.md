# Repo map

> Where everything lives. The rules that shape it are in
> [code-design.md](code-design.md).

## The workspace

```
silo/
├─ apps/
│  ├─ server/                 @silo/server — the CLI, HTTP API, core and adapters
│  └─ admin/                  @silo/admin  — the React admin UI
├─ packages/
│  ├─ shared/                 @silo/shared — runtime-neutral logic both sides need
│  └─ create-silo-plugin/     the published plugin scaffolder
├─ plugins/                   first-party plugins, one workspace package each
├─ tools/                     build, packaging, seeding and version tooling
├─ packaging/                 Homebrew formula template and RPM inputs
└─ docs/                      context/ (what is) and design/ (why)
```

One Bun workspace, one install root, one `bun.lock`. The root `package.json`
holds no runtime dependencies — it declares the members and delegates every
script.

## Root files

| Path | What it is |
|------|------------|
| `package.json` | Workspace root. Its `version` is the single source of truth (D28) — the binary, the archives, the RPM and the Homebrew formula all derive from it, and the release workflow refuses a tag that disagrees |
| `tsconfig.base.json` | Compiler options shared by every Bun-side package |
| `tsconfig.json` | One typecheck pass over the server, `shared` and `tools` |
| `CONTEXT.md` | Current state, and the index into `docs/context/` |
| `IMPLEMENTATION.md` | Vision, the D1–D37 decisions log, and the index into `docs/design/` |
| `CLAUDE.md` | Standing instructions for AI assistants |
| `silo.toml` | A commented example config; every key is optional |
| `Dockerfile` | Two stages — build the admin UI, then a runtime image with only the server's dependencies. Its `COPY` list must name every workspace manifest, or `bun install` aborts with "Workspace not found" |
| `.gitattributes` | `* text=auto eol=lf`. What it fixes is the *working tree* on Windows, where `core.autocrlf=true` would otherwise check the repo out as CRLF and break the byte-for-byte drift test between the scaffolder's `silo-api.d.ts` and the host's copy |

## `apps/server/src/`

| Directory | What it holds |
|-----------|---------------|
| `cli/` | `Cli` parses argv, `CliOptions` owns the flag table, `UsageText` the help, `CommandRouter` routes in three tiers, and `commands/` is one class per subcommand. `runtime/silo-runtime.ts` does the dependency wiring |
| `config/` | `Config` and its sub-shapes, `ConfigLoader`, and `PluginBlockWriter` — the only writer, and it appends rather than re-serialises |
| `core/domain/` | `Entry`, `Scope`, `Collection`, `Meta` and their helpers |
| `core/ports/` | `Storage`, `BlobStorage`, `DerivedIndex` — interfaces only, importing no adapter |
| `core/services/` | The application service layer. `SiloService` is the facade; `scopes`, `collections`, `entries`, `search`, `keys`, `transfer` and `media` are the services behind it. `support/` holds what they share — the `ServiceContext`, the schema cache, the write lock |
| `core/errors/`, `core/query/`, `core/schema/`, `core/keys/`, `core/media/`, `core/search/`, `core/transfer/`, `core/hooks/`, `core/plugins/` | One subject each. `core/plugins/` is the grant record and its rules (D34) — the store-side half of plugin authority, which `plugins/` reads but does not own |
| `adapters/storage/sqlite/` | The indexed adapter, split per table: migrations, meta, scopes, schemas, entries, media references, FTS documents, and the compiler and searcher on top |
| `adapters/storage/fs/` | The plain-files adapter, split the same way, with `FsLayout` holding the on-disk path grammar that *is* the export format (D5) |
| `adapters/blob/` | Filesystem and S3 blob stores |
| `adapters/http/` | The outbound client used by server-to-server copy |
| `http/` | `SiloServer` builds the Hono app; `routes/` is one class per route group, `auth/` the claim helpers, `middleware/` logging and auth |
| `logging/` | `Logger`, the level union, the `LogSink` port and its console/file implementations, and the two read-side helpers. Nothing here knows about HTTP or storage |
| `plugins/` | Five submodules with an index each — `manifest/` reads what a plugin declares without running it, `host/` executes it, `runtime/` is what it can see and do, `registry/` is the single wiring site, `install/` acquires it. Import from `plugins`, never a file inside |
| `runtime/` | Process lifecycle: the run file that records a live server, the daemon mechanics, the listen-address grammar, and the process title |

## `apps/admin/src/`

| Directory | What it holds |
|-----------|---------------|
| `api/` | `SiloApi` is the facade; `clients/` is one class per resource, `transport/` holds the one place a request is made, `types/` the DTOs |
| `components/` | Shared visual primitives, grouped by kind: `modal/`, `buttons/`, `feedback/`, `data/`, `brand/`, `controls/`, `navigation/` |
| `forms/` | The RJSF theme — `templates/`, `widgets/`, `fields/` |
| `query/` | `FilterModel` (the builder's flat model ↔ the Query AST), `UrlFilter` (its round trip through the address bar), `PathLabel` |
| `router/` | The client router and its route table |
| `schema/` | `SchemaDraft` (a JSON Schema document ↔ the visual builder's field list), `SiloRefs` |
| `styles/` | The intentionally global CSS foundation |
| `utils/` | `Formatters`, `ThemeManager`, `ScopeMemory`, `CollectionVisits`, `ByteSize` |
| `views/` | One directory per feature: `shell/`, `servers/`, `entries/`, `search/`, `schema/`, `keys/`, `media/`, `transfer/`, `settings/` |

## `packages/`

| Path | What it is |
|------|------------|
| `packages/shared/src/claims/` | The claim protocol: `Claims` is the facade over `ClaimVocabulary`, `ClaimGrammar`, `ClaimPresets`, `ClaimAuthorizer` and `ClaimSummary`. Both the server and the UI evaluate claims through it and nothing else |
| `packages/shared/src/` (rest) | `errors/`, `hooks/`, `keys/`, `media/`, `query/`, `schema/`. `hooks/` holds the `HookName` vocabulary, which moved here when hook delivery became a claim (D34) — the grammar validates it and the UI renders it, so neither side may own a second copy. Something belongs here when both sides need it *or* when shared itself must produce it; anything importing `bun:*`, node builtins, `hono` or React does not |
| `create-silo-plugin/src/` | The plugin scaffolder, published on its own. Nothing here may import from `apps/` or `packages/shared`, and nothing may use a `Bun.*` global — it runs under Node, and the facts it needs from silo are copied and drift-tested rather than imported. `render/` holds one class per generated file |

## `tools/`

| Path | What it is |
|------|------------|
| `build/` | The release build: `BuildBinary` orchestrates, `EntryGenerator` writes the compile entrypoint that embeds the admin UI, `Archiver` tars, `CodeSigner` re-signs Mach-O, `TargetTable` holds the platforms |
| `seed/` | A data seeder that speaks only the public HTTP API. `bun build tools/seed/main.ts --target=bun --outfile seed.js` makes it a single droppable file |
| `set-version.ts` | Writes the version into every manifest. Commits and tags nothing |
| `build-rpm.ts`, `render-formula.ts` | Packaging, driven by the release workflow |
