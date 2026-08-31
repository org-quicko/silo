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
│  └─ silo-plugin-strapi-import/  a Strapi 5 SQLite import — entries and media — with its own admin panel (D41)
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
| `IMPLEMENTATION.md` | Vision, the D1–D45 decisions log, and the index into `docs/design/` |
| `CLAUDE.md` | Standing instructions for AI assistants |
| `silo.toml` | A commented example config; every key is optional |
| `Dockerfile` | Two stages — build the admin UI, then a runtime image with only the server's dependencies. Its `COPY` list must name every workspace manifest, or `bun install` aborts with "Workspace not found" |
| `.gitattributes` | `* text=auto eol=lf`. What it fixes is the *working tree* on Windows, where `core.autocrlf=true` would otherwise check the repo out as CRLF and break the byte-for-byte drift test between the scaffolder's `silo-api.d.ts` and the host's copy |

## `apps/server/src/`

| Directory | What it holds |
|-----------|---------------|
| `cli/` | `Cli` parses argv, `CliOptions` owns the flag table, `UsageText` the help, `CommandRouter` routes in three tiers, and `commands/` is one class per subcommand. `runtime/silo-runtime.ts` does the dependency wiring |
| `config/` | `Config` and its sub-shapes, `ConfigLoader`, `ConfigScaffold` (the annotated default file, written by `silo init` and by an install that has no file to list a plugin in), and the two editors of a live `silo.toml`: `PluginBlockWriter`, which appends and removes a `[[plugins]]` entry rather than re-serialising, and `BlobStorageTable` (D45), which reads and replaces the `[blob_storage]` table. Both edit text and parse the result before writing it, refusing any edit that would have changed anything else |
| `core/domain/` | `Entry`, `Scope`, `Collection`, `Meta` and their helpers |
| `core/ports/` | `Storage`, `BlobStorage`, `DerivedIndex` — interfaces only, importing no adapter |
| `core/services/` | The application service layer. `SiloService` is the facade; `scopes`, `collections`, `entries`, `search`, `keys`, `plugins`, `audit`, `transfer` and `media` are the services behind it. `support/` holds what they share — the `ServiceContext`, the schema cache, the write lock |
| `core/errors/`, `core/query/`, `core/schema/`, `core/keys/`, `core/media/`, `core/search/`, `core/transfer/`, `core/hooks/`, `core/plugins/`, `core/audit/` | One subject each. `core/plugins/` is the grant record and its rules (D34) — the store-side half of plugin authority, including the config override a running instance may be given (D39), which `plugins/` reads but does not own. `core/audit/` is the authority-change trail (D38): the event shape, the actor, and the closed list of actions |
| `adapters/storage/sqlite/` | The indexed adapter, split per table: migrations, meta, scopes, schemas, entries, media references, FTS documents, and the compiler and searcher on top |
| `adapters/storage/fs/` | The plain-files adapter, split the same way, with `FsLayout` holding the on-disk path grammar that *is* the export format (D5) |
| `adapters/blob/` | Filesystem and S3 blob stores |
| `adapters/http/` | The outbound client used by server-to-server copy |
| `http/` | `SiloServer` builds the Hono app; `routes/` is one class per route group — `MediaStorageRoutes` (D45) registers before `MediaRoutes` for the reason `/api/media/folders` does, so `storage` is never read as an asset id — — including `ExtRoutes`, the single handler every plugin route is matched and dispatched through (D36) — `auth/` the claim helpers and the injected-principal slot a plugin dispatch arrives in (D35), `middleware/` logging and auth |
| `logging/` | `Logger`, the level union, the `LogSink` port and its console/file implementations, and the two read-side helpers. Nothing here knows about HTTP or storage |
| `plugins/` | Six submodules with an index each — `manifest/` reads what a plugin declares without running it: since D36 that is a `contributes` block (hooks, routes, a `runtime`, providers — none of them exclusive) and a `permissions` block splitting `required` from `optional` with a reason for each, read by one small reader per block so no file owns two grammars — `contract/` describes the client a plugin is handed and emits both halves of it (D35), `host/` executes it, `runtime/` is what it can see and do, plus the `PluginApiDispatcher` its `ctx.fetch` lands in and the `PluginRouteTable` a request is matched against (D36), `registry/` is the single wiring site and, since D39, the live one — `PluginRegistry` is a mutable ordered set that only `PluginSupervisor` mutates, with `PluginLifecycle`, `PluginConfigurator`, `PluginRescan`, D42's `PluginInstallation`, D43's `PluginUninstallation` and the read-only `PluginInspector` beside it — and `install/` acquires it. `PluginInstallation` and `PluginUninstallation` are the two places that *write* `silo.toml`: the first holds the order an install happens in (refuse before fetching, refuse before running, spawn ungranted, grant, list last) and the rule that the block it appends carries `claims = []`, because only the record half of a grant is checked and revocable; the second holds that order reversed (un-list first and fail hard, stop, forget the record and its key, delete the files last and forgive it), because a block naming a package that is gone fails the whole process rather than that plugin. `manifest/` also owns D41's two additions — a route's declared `body` contract, and `contributes.ui`, whose panel `registry/plugin-panel.ts` reads off disk for the one route that serves it. Import from `plugins`, never a file inside |
| `settings/` | Settings an operator changes through the API rather than by editing a file (D45, D46). Two subjects, one shape, which is what the directory is named for: a pure half that decides which value wins, and a supervisor that writes one table of `silo.toml` and applies the result live. `MediaStorageSettings`/`MediaStorageSupervisor` own `[blob_storage]` — parse a body, merge over *the file* so an env-held secret is never copied into it, check the driver, write, re-read the config the way a start reads it, open the store from that, swap it in, and put the file back if any of it fails. `MediaPolicySettings`/`MediaPolicySupervisor` own `[media]` the same way: where media URLs point and what the library accepts. Separate because a bucket that will not open must not hold up a correction to the allowlist. `ConfigSectionSettings`/`ConfigSupervisor` (D47) cover the rest of the file, driven by the `ConfigSections` spec rather than hand-written, and are the first pair that cannot always apply what they save: they keep the config the process *started on* separate from the file and report the difference as a restart owed. Import from `settings`, never a file inside |
| `runtime/` | Process lifecycle: the run file that records a live server, the daemon mechanics, the listen-address grammar, and the process title |

## `apps/admin/src/`

| Directory | What it holds |
|-----------|---------------|
| `api/` | `SiloApi` is the facade; `clients/` is one class per resource, `transport/` holds the one place a request is made, `types/` the DTOs |
| `claims/` | `ClaimGroups` (a claim set → the handful of sentences it means) and `ClaimWords` (the vocabulary it reads them in). Used by the key form and the plugin grant screen, which is why it is not inside either |
| `components/` | Shared visual primitives, grouped by kind: `modal/`, `buttons/`, `feedback/`, `data/`, `brand/`, `controls/`, `navigation/` |
| `forms/` | The RJSF theme — `templates/`, `widgets/`, `fields/` |
| `query/` | `FilterModel` (the builder's flat model ↔ the Query AST), `UrlFilter` (its round trip through the address bar), `PathLabel` |
| `router/` | The client router and its route table |
| `schema/` | `SchemaDraft` (a JSON Schema document ↔ the visual builder's field list), `SiloRefs` |
| `styles/` | The intentionally global CSS foundation |
| `utils/` | `Formatters`, `ThemeManager`, `ScopeMemory`, `CollectionVisits`, `ByteSize` |
| `views/` | One directory per feature: `shell/`, `servers/`, `entries/`, `search/`, `schema/`, `keys/`, `media/`, `plugins/`, `transfer/`, `settings/`. `settings/pages/` holds one file per settings page, with a data hook beside each; `ConfigurationPage` (D47) is the newest — one card and one Save per table of `silo.toml`, drawn from a spec the *server* sends so a new setting needs no admin change, with `config-section-draft.ts` as its pure half. `MediaStoragePage` (D45, D46) carries two cards with two Saves for the two tables behind it; `media-storage-draft.ts` and `media-policy-draft.ts` are their pure halves. The storage draft is seeded from what the *file* holds rather than from what is in force, which is what keeps a derived media path from being saved back as a literal; the policy draft deliberately does the opposite for the extension list, since an empty one is not a state the server accepts and a box showing nothing while something is enforced would lie in the other direction. `plugins/` (D40) holds the list, one plugin's page, and `PluginGrantPlan` — the pure half of the grant form, so the rules a grant screen must get right are testable without a DOM. Since D44 that page is a summary: `Plugin*Section` files are the contents of a `Sheet` (`components/modal/Sheet.tsx`, the app's second overlay — a modal asks a question, a sheet holds a section), opened from `PluginSectionButton`s that keep each section's *state* on the page. `claims/` beside it turns claim strings into words, with the claim *families* derived from its own catalogue rather than listed (D36). `plugins/panel/` (D41) is the iframe contract: `plugin-panel-protocol.ts` is the whole boundary and is pure so it can be tested without a DOM, `plugin-panel-preamble.ts` generates the `window.silo` client and theme tokens injected into a panel's `srcdoc`, and `PluginPanelFrame` is the parent half of the relay. `media/` (D48) holds the two-dialog delete flow: `media-delete-outcome.ts` is the pure half — splitting a bulk delete result's failures into `media_in_use` versus the rest (an empty `inUse` is Case A, no second dialog), and denormalizing `media_in_use` failures back against the assets a caller was showing — and `use-media-delete-flow.ts` is the hook that drives `DeleteAssetDialog`/`AssetInUseDialog` from it, so a single-file trash click and a multi-select share the one path. `use-media-library.ts` gives `not_found`/`invalid_id` and `media_delete_stalled` each their own dismissible banner state, neither cleared by the `reload()` a successful delete in the same batch triggers. `MediaSelectionBar` is the bar a selection shows; `components/controls/Checkbox.tsx` is the plain selection checkbox it and the row/card checkboxes use, distinct from `forms/widgets/CheckboxWidget.tsx`'s RJSF `Toggle` |

## `packages/`

| Path | What it is |
|------|------------|
| `packages/shared/src/claims/` | The claim protocol: `Claims` is the facade over `ClaimVocabulary`, `ClaimGrammar`, `ClaimPresets`, `ClaimAuthorizer` and `ClaimSummary`. Both the server and the UI evaluate claims through it and nothing else |
| `packages/shared/src/` (rest) | `errors/`, `hooks/`, `json/`, `keys/`, `media/`, `query/`, `schema/`. `json/` holds `MergePatch` (RFC 7396), which lives here because the server *applies* a config patch and the admin UI has to *produce* one — two implementations either side of one endpoint agree until a nested key is deleted. `hooks/` holds the `HookName` vocabulary, which moved here when hook delivery became a claim (D34) — the grammar validates it and the UI renders it, so neither side may own a second copy; D36 added the collection-level `collection.afterDelete` to it. Something belongs here when both sides need it *or* when shared itself must produce it; anything importing `bun:*`, node builtins, `hono` or React does not |
| `create-silo-plugin/src/` | The plugin scaffolder, published on its own. Nothing here may import from `apps/` or `packages/shared`, and nothing may use a `Bun.*` global — it runs under Node, and the facts it needs from silo are copied and drift-tested rather than imported. `render/` holds one class per generated file, and `plugin-routes.ts` holds the `--routes` grammar and the body ceiling it refuses against (D41) |

## `tools/`

| Path | What it is |
|------|------------|
| `build/` | The release build: `BuildBinary` orchestrates, `EntryGenerator` writes the compile entrypoint that embeds the admin UI, `Archiver` tars, `CodeSigner` re-signs Mach-O, `TargetTable` holds the platforms |
| `seed/` | A data seeder that speaks only the public HTTP API. `bun build tools/seed/main.ts --target=bun --outfile seed.js` makes it a single droppable file |
| `set-version.ts` | Writes the version into every manifest. Commits and tags nothing |
| `build-rpm.ts`, `render-formula.ts` | Packaging, driven by the release workflow |
