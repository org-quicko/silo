# silo — Implementation Document

**Status:** draft v1 · 2026-07-03
**One-liner:** a minimal, self-hostable headless CMS in a single Go binary. Define collections with JSON Schema, get forms and a CRUD API, and move your data anywhere with first-class export/import.

---

## 1. Vision & positioning

Pocketbase already owns "Go single binary + SQLite + admin UI." silo's reason to exist is **portability**: your content is never trapped.

- Schemas are **standard JSON Schema** documents — readable by any tool, not a proprietary DSL.
- Storage is **pluggable** — SQLite and plain files at launch; the plain-files backend is git-friendly.
- **Export/import is the headline feature**, not an afterthought: any instance can be cloned, backed up, diffed, and migrated across storage backends with one command.

Where Pocketbase optimizes for features (auth, realtime, hooks), silo optimizes for data being trivially movable.

## 2. Decisions log

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Data model | Document model (JSON blob + envelope), never schema→table mapping | Keeps every future storage adapter cheap; avoids adapter interfaces converging on lowest-common-denominator SQL |
| D2 | Entry IDs | ULID | Sortable, globally unique, no coordination — required for import/merge and future sync. Autoincrement would permanently poison replication |
| D3 | Schema language | **Full JSON Schema draft 2020-12** | Maximum interop and expressiveness. Consequence: validation is full-spec (via library); *form rendering* is best-effort with a raw-JSON fallback (see §5.2) |
| D4 | Admin UI | React SPA + react-jsonschema-form (RJSF), embedded in the executable (originally `go:embed`; Bun file imports since D26) | Form generation from JSON Schema is a solved problem in RJSF. Node build step lives in the dev toolchain only; users get one binary |
| D5 | Export format | **Identical to the filesystem adapter's on-disk layout** | An fs-backed instance is a live export: backup = `cp`, replication = `rsync`/git. Cost accepted: the layout is a frozen public format |
| D6 | Replication scope (v1) | One-shot export/import only | Sync-ready metadata (`rev`, `seq`) baked into the envelope, but no sync engine ships in v1 |
| D7 | Cache adapters | **Not in v1, not even the interface** | SQLite at CMS scale is the cache. No speculative interfaces with zero implementations |
| D8 | Auth (v1) | Shlink-style API keys with explicit capability claims. Anonymous collection reads are open by default unless `"x-silo-auth": true` is set; authenticated requests are bounded by their key's claims. | Deny-by-default capabilities make least-privilege keys possible without coupling unrelated operations into roles, while anonymous public content remains convenient. |
| D9 | SQLite driver | `modernc.org/sqlite` (pure Go, CGO-free) | Single static binary, painless cross-compilation for releases |
| D10 | HTTP router | Go ≥1.22 `net/http` method patterns | No router dependency needed |
| D11 | CLI | stdlib `flag` + hand-rolled subcommands | Keep dependency tree minimal; cobra adds weight for little gain at this scale |
| D12 | Key storage | Keys live in a reserved system collection (`_keys`) with a validated claims array; SHA-256 hash only, secret shown once at creation | Reuses the doc model, envelope, and export machinery; zero growth of the `Storage` interface — every adapter supports keys for free |
| D13 | API versioning | None — clean routes under `/api`, no `/v1` | Server and embedded UI ship in one binary (no skew); external consumers pin the binary version. If a break is ever unavoidable, version at that point (new routes or a header). The export format is versioned separately via `format_version` |
| D14 | `format_version` handling | Single `core.FormatVersion` constant (currently `"2"`, since D18 rescoped the on-disk layout), stamped into the SQLite `meta` table, the fs `manifest.json`, and every export manifest; imports **reject** an unknown `format_version`. Release artifacts: one `bun build --compile` executable per platform, archived and checksummed (D26), plus a Dockerfile. | One source of truth prevents the version literal drifting across adapters. Refusing an unrecognized format fails safe instead of silently corrupting data. Versioned independently of the binary/API (D13), so the layout can stay frozen (D5) across many releases — a bump is still cheap pre-1.0, where breaking the layout is expected rather than migrated. |
| D15 | Projects | Reverted / Rejected | Projects support in the backend was removed in favor of Shlink-style frontend multi-server support. Collections and entries have a clean, flat namespace on the server; the frontend client manages connecting to, listing, and switching between different silo server instances stored in `localStorage`. Superseded by D18, which reintroduces projects at the storage layer on different terms (plain containers, not a registry entity). |
| D16 | Blob Storage | Pluggable Blob Adapter Pattern (`BlobStorage` interface) with local filesystem (`FsBlobStorage`) and S3 (`S3BlobStorage`) implementations | Decouples media and file storage from direct filesystem paths; enables plugging in any cloud or local storage backend while preserving cross-adapter media export/import portability. |
| D17 | Direct server copy | Destination-driven composition of the existing claim-protected export and import APIs | Keeps one portability format and one merge/replace implementation. The destination supplies a source URL and key; data-only leaves destination keys intact, while data-plus-keys copies `_keys` hashes under separate key export/import claims. |
| D18 | Projects & environments (storage layer) | A collection is identified by `(project, env, collection)`, not name alone. `Scope` (`server/core/domain/scope.ts`) is a plain value object — no registry entity, no metadata beyond the two ids. A scope's existence is *derived*: it exists exactly when a schema or entry has been written under it, discovered via `Storage.listScopes()`, never stored in a separate collection. `_keys` and any future system data live in one reserved scope, `Scope.System` (`_system`/`_system`), built through a private constructor that bypasses id validation — adapters store it exactly like any other scope, with no special-cased code path. `seq` stays instance-global and monotonic across every scope (still the future change-feed cursor, D1/§12.1). The HTTP API, claim grammar, media storage, and export scoping are unchanged this phase — every route passes `Scope.Default` explicitly; scoping them is later work. | Supersedes D15's revert: that decision rejected projects as a *registry* concept coupled to routing; this one reintroduces them as a storage-level partition with zero registry overhead, so it doesn't reheat the reasons D15 gave for reverting. Deriving existence from content (rather than a `_projects` collection) keeps the invariant D5/D12 rely on — every adapter already supports arbitrary collections "for free" through the one `Storage` interface, and a registry would be a second source of truth that could desync from what's actually on disk. Reusing a reserved scope for system data (rather than a `Storage`-level special case) is the same trick D12 used for `_keys` itself: one code path, not two. |
| D19 | Projects & environments (HTTP API & Scoped Claims) | Scoped routes (`/api/projects/{project}/envs/{env}/collections/...`) replace the flat routes (`/api/collections/...`) with no back-compat aliases. Scope is validated at the HTTP boundary via `Scope.of`. The claim grammar is scoped to `collections:<project>/<env>/<name>:<permission>` with independent per-segment wildcards. `ParsedClaim` evaluates matching and non-escalating delegation (named cannot widen to wildcard; a key can only delegate what it holds). | Completes Phase 2 scoping for the HTTP and auth boundary. Independent per-segment wildcards provide fine-grained multi-project and multi-environment authorization while preserving deny-by-default capabilities and prohibiting action wildcards. |
| D20 | Decoupled Projects & Environments Architecture | Decouple Scope into individual `project` and `environment` concepts. Dedicated SQL tables for `projects` (`id, created_at, updated_at`) and `environments` (`project, id, created_at, updated_at, PRIMARY KEY (project, id)`). Server defaults configured to `project: default, env: prod` on startup via CLI (`--project`, `--env`), TOML, and env vars. REST routes: `GET/POST /api/projects`, `DELETE /api/projects/:project`, `GET/POST /api/projects/:project/environments`, `DELETE /api/projects/:project/environments/:env`. Scoped claims allow project-level (`project/*/*`), env-level (`project/env/*`), and collection-level grants. Admin UI `/servers` expanded into a 3-pane macOS column / Ranger file manager view (Server -> Project -> Environment) with in-app scope switcher removed; deep URLs formatted as `/servers/:serverId/projects/:project/environments/:env/...`. | Eliminates tight coupling between project and env; allows projects to exist independently of environments, environments to exist independently of schemas, and cleanly structures navigation, authorization, and multi-tenant hosting. Supersedes D19's `_projects` registry collection, which existed only to make an empty project listable and is deleted. **Existence rule:** a project or env exists when it was created explicitly *or* still holds a schema or an entry — both halves, in every adapter. D18 defined existence as content alone, which cannot represent a project created before anything is written into it; keeping only the explicit half would hide scopes an import or a direct `put` brought into being. SQLite answers this from its two tables; the fs adapter writes a `.silo-project`/`.silo-env` marker file, because a directory alone cannot distinguish "created" from "left behind by a delete" and reading it either way loses one of the two halves. `Storage.listScopes()` therefore reports created-but-empty scopes, which is what lets an export carry them. Ids from configuration (`--project`/`--env`, `SILO_DEFAULT_*`) are validated at startup like any other caller-supplied id. |
| D21 | Transfer claims require instance-wide authority | `transfer:export`, `transfer:import` and `transfer:copy` stay fixed (unscoped) claims, but holding one is no longer sufficient. Export additionally requires `collections:*/*/*:schema:read` and `collections:*/*/*:entries:read` (`Claims.TransferReadPermissions`); import and copy additionally require `collections:*/*/*` `create`, `schema:update`, `entries:create` and `entries:update` (`TransferWritePermissions`), plus `delete` and `entries:delete` when `mode=replace` (`TransferReplacePermissions`, checked only in that mode). The write list is split by mode for the same reason D22 splits its own: the apply stage writes schemas and creates the scopes and collections an archive names in **both** modes, but deletes only in `replace`. Media (`media:*`) remains instance-global and unscoped — an accepted deferral, not a decision that it should stay that way, and the import path still writes and (in `replace`) clears blobs without asking for `media:create`/`media:delete`. | An archive is instance-wide: one file spans every project and env, and scoping it is later work. Before D19 that was unremarkable, because there was one flat namespace and no boundary for it to cross. Once claims name a project, a fixed `transfer:export` becomes a way for a key confined to one project to read every other one, and `transfer:import` a way to overwrite them — the exact boundary the scoped grammar exists to draw. Requiring the caller to already hold, at instance scope, the permissions the operation exercises makes the transfer claim a gate on the *mechanism* rather than a grant of authority the key does not otherwise have. The first cut of the write list named only the three entry permissions, which did not hold: `Importer.executeScopedImport` calls `putSchema` for every collection in the archive in both modes and `deleteSchema` in `replace`, so `transfer:import` plus `entries:*` at `*/*/*` could overwrite or delete every schema in the instance without holding `schema:update`, `create` or `delete` at any scope — precisely the grant of unheld authority this decision exists to deny. The list now tracks what the apply stage actually calls, mode by mode, so "the permissions the operation exercises" is a statement about the code rather than about entries alone. |
| D22 | Scope-to-scope copy | A new destination-driven route, `POST /api/projects/{project}/environments/{env}/copy`, copies one scope's schemas and entries onto another **of the same instance**; the body names the source (`{from: {project, env}}`) and carries the same `mode`/`prefer`/`validate`/`dry_run` options an import does. It owns no merge logic: `Importer.executeImport` already takes `{manifest, scopes}` in memory rather than a directory, so `ScopeCopier` only reads the source scope out of `Storage` into the same `ScopedImport` shape `ImportWalker` builds from an archive, re-enveloping each entry onto the destination. Authorization requires **no `transfer:*` claim at all**: `Claims.ScopeCopyReadPermissions` at the source scope, `ScopeCopyWritePermissions` at the destination, plus `ScopeCopyReplacePermissions` there in `replace` mode — all ordinary scoped collection claims, checked with `Claims.hasScopeWide` / `RouteAuth.requireScopeWide`. Copying a scope onto itself, or either side being `Scope.System`, is a `400`. Media is untouched. | D21 deferred scoping the transfer surface, which left moving data between two environments of one project needing a whole-instance archive round trip — and, because of D21's own rule, instance-wide authority to perform it. A project-confined key could not promote its own dev environment to prod. Reusing the import apply stage rather than forking it keeps one implementation of merge/replace/prefer/dry-run, so copy and import semantics cannot drift. Requiring no fixed claim is the substance of the decision: unlike an archive, a scoped copy reaches nothing the caller could not already reach by listing the source through the entry API and writing the destination through it, so the guard asks for exactly the permissions that hand-rolled loop would need. Adding a `transfer:*` gate on top would reintroduce the very coupling D21 exists to prevent. The whole-instance archive is unchanged and keeps D21's rule. |
| D23 | Media catalog & reference integrity | Media gains a **catalog** — a `_media` system collection in `Scope.System`, one document per asset (`filename`, `folder`, `blob_key`, `size`, `content_type`, `hash`, `state`, `tags`) — plus `_media_folders` for folders that exist before anything is filed into them. `BlobStorage` stays byte-only (6 methods). Entries reference an asset by **stable id**, `silo://media/<ulid>` (`MediaRef`, `@silo/shared/media-ref`), never by storage path, so rename and move are catalog-field updates that rewrite no entry and touch no blob. Blob keys stay **flat and content-free of organization**: folders are metadata, so the archive's `media/` layout is unchanged and no `format_version` bump is needed. **Usages are adapter-owned derived state, not a collection.** `Storage.put` takes the entry's *complete* usage set alongside the entry and replaces it in the same operation — callers extract (`MediaRefs.extract`, one shared walker), adapters never parse URIs; `delete`, `deleteProject` and `deleteEnvironment` drop matching usages; `listMediaUsages`/`countMediaUsages` answer the guard. SQLite keeps a `media_references` table written inside `put`'s existing transaction; the fs adapter **scans** entry files at query time and stores no index at all. Deletion is a saga in `Service` under `writeMu`: refuse at non-zero usages with a `409` that always reports the count but enumerates only referrers the caller may read, else mark the asset `deleting`, delete the blob, delete the catalog record — startup retries any asset left `deleting`, and `Service` refuses new references to one, and `silo media reconcile` returns an asset to `active` when the blob delete fails again, so a permanently failing delete cannot strand it. There is **no force-delete**. | Three asks — folders, search, reference integrity — are one missing piece: media had bytes but no record. `listMedia` reconstructed metadata by string-splitting blob keys, so there was nowhere to put a folder, a tag, or a reference, and no way to page or filter without stat-ing every blob. A catalog is the D12 move (`_keys` reused the doc model and got adapters, export and conformance for free) and it makes search the existing Query AST over `_media` — `contains` on `filename`, `eq` on `folder` — with **no new Query AST op**, which matters because §5.3 makes every op permanent. Usages are the opposite case and must not be a collection: they are a pure function of entry data, so persisting them as documents is the second source of truth D18 rejected for `_projects`, and — decisively — a generic `Storage.put` of an index document **cannot be atomic** with the entry write it belongs to. SQLite already wraps `put` in a transaction to allocate `seq`; putting the usage set on the port lets the reference land inside it, converting a convention into an invariant. A `Storage` decorator was considered and rejected for exactly this: it can intercept `deleteProject`, but it cannot be atomic with that method's bulk SQL delete, so entries would vanish while their usages survived and a file would stay blocked by referrers that no longer exist. The fs adapter keeps **no** index because its own reason to exist is rsync and git: an in-memory index rebuilt on open goes stale the moment someone checks out a branch under a running process, and that staleness silently permits deleting a referenced file — the exact failure this decision exists to prevent. Scanning has no staleness window, needs no rebuild, and is precisely the O(n)-per-query character §6.3 already commits that adapter to. Port growth is therefore only what the invariant needs, and conformance pins delete-while-referenced on both adapters. The usage argument to `put` is **required, not optional**: an omitted optional parameter has no unambiguous reading — "clear" silently orphans a live reference, "leave" silently rots the index — so forgetting it is a type error at all four call sites (`Service`, `Importer`, `ScopeCopier`, `CollectionEraser`) instead of a bug. Stable-id identity costs the `immutable` cache header (bytes behind an id may change), which is the honest price of references that survive a rename. `media:*` stays instance-global and unscoped, and folders are organization rather than a security boundary — scoping them would reheat D21. |
| D24 | Transfer honours media claims | `GET /api/export` additionally requires `media:read`; `POST /api/import` and both copy routes additionally require `media:create`, plus `media:delete` when `mode=replace`. | Closes the deferral D21 named and left open: the import path writes blobs, and in `replace` deletes every blob in the instance, while asking for no media claim at all. That was already a way for a key holding `transfer:import` to wipe media it could not otherwise touch; D23 makes it worse by putting the catalog behind the same archive. This is D21's own rule applied to the one surface D21 skipped — the transfer claim gates the mechanism, and the caller must independently hold the permissions the operation exercises. Split by mode for the same reason D21 splits its own list: import writes blobs in both modes and clears them only in `replace`. |
| D25 | Running as a service: one server per data directory | `silo serve` gains `--detach`, and three commands join it: `silo stop`, `silo status`, `silo logs [-n] [--follow]`. A running server records itself in `<data dir>/silo.run.json` (`RunFile`, `RunState`) — pid, version, the address actually bound, driver, data dir, log path, start time — written **after** the bind succeeds and removed on clean shutdown. Every `serve` writes it, foreground or detached, and every `serve` refuses to start when it finds one whose pid is still alive (`RunFile.assertNotRunning`). Liveness is `kill(pid, 0)`, so a record left by a crash is stale and can be stolen rather than locking the directory out of use. Logging becomes configurable (`[log]`: `level`, `file`, `format`, `requests`, `max_size_mb`, `max_files`) through a `Logger` with pluggable `LogSink`s — console and a rotating file. `[log] file` is left **unset** by default, following D-era precedent for derived settings; only a detached run derives one, at `<data dir>/silo.log`, and passes it to the child explicitly as `--log-file`. Detaching is `spawn(detached)` with the child's stdio redirected into that same log file. The parent waits for the child's **own run file, matched by pid** — never for `/api/health` — before reporting success. | silo was a foreground process that printed to the terminal it was started from, so running it as a service meant `nohup`, a redirect, and no way to ask whether it was up. The run file answers that, and while it is there it also closes a hole nothing else could: **two servers on one data directory are not a race, they are silent corruption.** The fs adapter holds `last_seq` in memory and both processes hand out the same `seq` values — measured, not theorised: two instances writing to one fs data dir produced `seq` 2,2,3,3,4,4, and `seq` is the instance-global cursor a change feed will depend on (§5.1, §12.1). `Service` also serialises writes on a process-local `AsyncMutex`, which is precisely what makes optimistic concurrency sound without CAS in the adapters (§6.1), and the compiled-validator and public-scope caches invalidate in-process only. No adapter can defend against this from where it sits, so the guard belongs at the process boundary. The one file carries the bound address rather than a bare pid because `silo status` must not re-derive it from configuration — a server started with `--listen` would then be reported at the wrong port. Waiting on the child's run file rather than on `/api/health` is the same class of mistake caught in review and fixed before release: a port already held by *another* instance answers a health probe perfectly well, so a child that died on `EADDRINUSE` was reported as a successful start, complete with a pid that no longer existed. The run file is written by the child, after the bind, stamped with its own pid; nothing else distinguishes "my child is up" from "something is up". Rotation ships with the file sink because an unbounded log on a process designed to run for months fills the disk the database is on. |
| D26 | Distribution: one build path, embedded UI, signed checksums | `scripts/build.ts` (`BuildBinary`) is the only way an executable is produced, local or released — it builds `ui/dist`, generates a compile entrypoint that imports every UI file with `with { type: "file" }` and registers the route→path map on `UiAssets`, compiles for `--target`, stamps the version through `--define SILO_VERSION`, ad-hoc signs Mach-O output, and archives. `.github/workflows/release.yml` runs it for darwin-arm64, darwin-x64, linux-x64 and linux-arm64 on a `v*` tag, then signs a single `SHA256SUMS` **twice** — Sigstore keyless via GitHub OIDC, and GPG — attaches build-provenance attestations, and regenerates the formula in `org-quicko/homebrew-tap` from `packaging/homebrew/silo.rb.tmpl`. Darwin binaries are ad-hoc signed, not Developer ID signed. | A packaged silo is a single file on `$PATH` run from an arbitrary directory, which is the one thing the previous build could not produce: the server read `./ui/dist` relative to the working directory, so an installed binary had no admin UI. Embedding is Bun's file imports rather than a bundler asset pipeline because those paths survive `--compile` into the virtual filesystem and `Bun.file` reads them unchanged, so the same code serves both cases. The build is a script CI merely calls, rather than steps in a workflow, so that a release artifact can be reproduced on a laptop and a broken release can be bisected without pushing tags. Signing splits three ways and only one part can be shared: a signature over the checksum file is one identity every package manager can be pointed at, GPG is additionally what an apt or rpm repository will require, and neither can substitute for Apple's or Microsoft's code signing, which trust only certificates they issued. Ad-hoc signing on Darwin is not a weaker choice on that axis but a functional requirement — `--compile` invalidates the signature its Bun copy arrived with and macOS on arm64 kills such a process at exec — and it is sufficient for Homebrew, whose formula downloads are never quarantined. Both Darwin targets build on the macOS runner because `codesign` exists nowhere else; cross-compiling the x64 half there costs nothing and removes any dependence on the retiring Intel runner image. |
| D27 | dnf packaging: a signed repository, not a downloadable RPM | A `rpm` job builds one signed RPM per architecture with **nfpm** from `packaging/rpm/nfpm.yaml`, driven by `scripts/build-rpm.ts`; a `dnf-repo` job indexes the last `DNF_REPO_RELEASES` releases with `createrepo_c`, signs each `repomd.xml`, and publishes to **GitHub Pages**, where the site is a derived index rebuilt from release assets rather than a store of its own. The package is a service package: a `silo` system user, `/etc/silo/silo.toml` as `config|noreplace`, `/var/lib/silo` at `silo:silo 0750`, and a systemd unit whose `%post` runs `systemctl preset` rather than `enable`. One package per architecture, not per distribution. | The machines silo is deployed on are EC2 instances, and a tarball is not how anything gets onto one — a repository is, because it is the only form that supports `dnf update`. Signing both the packages and the index is the point rather than a formality: `gpgcheck` proves each package's origin, and without `repo_gpgcheck` whoever serves the index still chooses which signed packages a host is offered, including a superseded one. This is the apt/rpm use the RSA-4096 release key was chosen for in D26. Pages carries no state because the alternative is an unwritten retention policy: at roughly 60 MB of RPMs per release against a 1 GB soft limit, something has to be dropped eventually, and deriving the index from the last few releases makes that explicit and reproducible instead of silent. One package spans the family because the compiled binary needs no symbol newer than `GLIBC_2.17` and links no libstdc++, measured against the released artifact rather than assumed — Amazon Linux 2023 ships glibc 2.34. `preset` rather than `enable` because a package manager must not open a network port on a host nobody has configured; the install prints the one command that does, and where the one-time root key will be. |
| D28 | One version, in `package.json` | The root manifest's `version` is the only place the number is written. `server/version.ts` exports `SiloVersion` — the manifest's value, imported rather than duplicated so `--compile` bundles it, with a `-dev` suffix unless a release build overrode it via `--define SILO_VERSION`. `Cli`, `Exporter` and `scripts/build.ts` read that constant instead of holding literals. `bun run set-version <v>` rewrites every workspace manifest in place, committing and tagging nothing, and the release workflow refuses a tag that disagrees with the manifest (a warning rather than an error for a `workflow_dispatch` rehearsal). `server/test/version.test.ts` pins all of it. | The number had four homes — two manifests, the CLI, the exporter — and a stale one is invisible: a binary reporting last release's version looks exactly like one reporting this release's, and the mistake surfaces in a bug report filed against the wrong artifact. Importing the manifest rather than restating it is what removes the copies outright instead of adding a rule about keeping them in step; bundling means it costs nothing at runtime and needs no build flag to be correct. The `-dev` suffix is kept because collapsing every build onto one number would lose the distinction that actually matters day to day — whether a binary is the published artifact or something someone built on a laptop — so a release marks itself by passing the tag and everything else marks itself by not. Validating the tag against the manifest closes the last gap the constant cannot: a tag is a request to publish what the tree already says, and when the two disagree the artifacts would be named for one version and built from a tree that believes in another. The private workspace manifests move too, not because anything reads them, but because a reader cannot tell an inert version from a stale one. |

| D29 | Query addressing is RFC 9535 JSONPath | Filter and sort fields become **paths**, not a private dot-grammar: `Filter.field` is renamed `Filter.path` and carries `$.data.author.name`, `$.id`, `$.data.tags[*]`. The subset is named and closed — root, name selector, array index (negative included), child wildcard `[*]`/`.*` — and the parser **refuses** recursive descent, slices, index unions, filter selectors, functions and script expressions rather than ignoring them. The query root is a **virtual entry document** — `{ id, rev, created_at, updated_at, data }` — whose envelope half is exactly the envelope fields `EntryUtils.toApiResponse` returns, with user fields addressed under `$.data` rather than flattened as the wire response does. `project`/`env`/`collection`/`seq` are absent from it because the API hides them, so they are unaddressable by derivation rather than by a second allow-list. Cardinality is part of the contract: a leaf op is true when **any** selected node satisfies it, and **ANY over zero nodes is false for every op, `neq` included**. `contains` narrows to string substring only; array membership is `eq` over `[*]`. `exists` and `not` join the op set. Parser and AST live in `shared/src/query/path/` (UI, validator, both engines); only the SQL compiler is adapter-local. No compatibility shim and no detection of the old syntax — this is an API-breaking release. | Two forces meet here. D3 chose full JSON Schema over a proprietary DSL for interop; the query surface was still a private grammar (`author.name`, `$id`) that every client had to learn and every adapter had to re-derive. RFC 9535 is a real standard, so adopting it buys the same interop D3 bought, and it retires the `$`-prefix hack whose collision with JSONPath's root made the two unmixable. Deriving the root from the API response shape, rather than listing permitted fields, means a future envelope field stays unqueryable until someone deliberately exposes it — one source of truth instead of two that drift. The subset is closed rather than "a subset of RFC 9535" because an unnamed subset is not a contract: recursive descent alone would force `json_tree()` (a full-subtree walk) into the compiler and invite the rest back in, while `json_each()` covers the child wildcard at a fraction of the cost. The ANY-over-empty rule is stated because it silently changes shipped behaviour — `neq` on a missing field returns *true* today and *false* after — and no test using present fields would catch it; the old reading is still expressible as `or(not(exists(p)), neq(p, v))`. Narrowing `contains` gives one operator one meaning and deletes the `json_type(...) = 'array'` branch from the SQL compiler and the array branch from the scan evaluator; `[*]` is a better spelling for what those branches did. `not` compiles to `NOT COALESCE(<cond>, 0)`, never a bare `NOT`: SQL three-valued logic drops NULL rows, so a bare `NOT` diverges from the in-memory evaluator on exactly the missing fields a negation is usually asked about (measured: 0 rows vs 2). The shim was considered and rejected — D13 puts the server and the embedded UI in one binary so there is no skew, D18 already broke the on-disk layout outright on the stated pre-1.0 principle that breaks are expected rather than shimmed, and two live grammars would double the query test matrix and still need a breaking release to remove. |
| D30 | Search behind an optional `Searcher` port, FTS5 where available | Search is a **new port**, not a new Query AST op: `Searcher.search(req, access)` / `reindex(target?)` / `capabilities()`, with two implementations — `ScanSearcher` (core, works on every adapter, O(N)) and `SqliteSearcher` (FTS5, external-content, `bm25(fts, 10.0, 1.0)`). Three reaches, addressed by path exactly like every other scoped resource and **`GET` only**: `/api/projects/{p}/envs/{e}/collections/{name}/search`, `/api/projects/{p}/envs/{e}/search`, and `/api/search`. The indexed text is **derived by the caller** — `SearchText.extract(data, schema)`, driven by an `x-silo-search` schema keyword (`label`/`include`/`exclude` paths, D29 grammar); adapters read no schema. It is **carried on the port** (`Storage.put(e, { usages, search })`) only once an engine stores it: `ScanSearcher` extracts at query time, so the port change lands with `SqliteSearcher` rather than ahead of it — a required argument every caller computes and every adapter ignores is the speculative interface D7 rejects. Claims are compiled by the service into a `SearchAccess` plan of concrete targets (public collections expanded into it) and applied **before** rank, count and paging; adapters parse no claim strings. An anonymous caller reaches a collection only when it **has a schema** that does not set `x-silo-auth`: a collection with no schema at all (§6.1) has had nothing declared about it, so inferring public from an absent declaration would publish content by accident. SQLite keeps `entry_search_documents` (explicit `docid INTEGER PRIMARY KEY`) plus `entry_search_fts` external-content, maintained by triggers inside the transactions that already exist in `put`/`delete`/`deleteProject`/`deleteEnvironment`. Index state is versioned on four inputs — engine, FTS schema, tokenizer config (global) and extractor version + per-collection `x-silo-search` hash — so a global change rebuilds everything before the bind and a schema change rebuilds one collection. `silo search reindex [--check]` runs **two** integrity checks. A search hit discloses `project`/`env`/`collection` on the hit wrapper, never on the entry. Media stays out of the entry index. No numeric relevance score is exposed. `format_version` does not change. Snippets come from the **shared** builder on both engines rather than FTS5's `snippet()`: only two concatenated columns are indexed, so `snippet()` could say that a body matched but never *which field* did, and re-extracting over one page removes an engine difference instead of adding one. A snippet is `{ path, before, match, after }` — three strings, never one with `[...]` markers in it. Opening with search disabled clears the stamp and drops nothing, because opening is not a destructive act — every CLI subcommand opens the store. | §12.6 already named this shape; the reason it is a port and not a `search` op is §5.3's own rule that every op is permanent for every adapter — an FTS op would force Turso, S3 and a future Postgres adapter to reproduce BM25 ranking forever, whereas a port lets each answer with what it has and lets `ScanSearcher` cover the rest. That is also why the portable engine ships **first**: search then works everywhere on day one, and FTS5 makes it fast rather than possible — which matters because the shipped SQLite build sets `OMIT_LOAD_EXTENSION`, so a build without `ENABLE_FTS5` cannot be repaired at runtime and must fall back, not fail. Caller-derived index text is the D23 move exactly: the extractor needs the schema (to weight a title above a 40 KB body, and to keep an internal note out of the index), the adapter must not, and an omitted argument has no safe reading — so it is required, not optional, and system data passes `search: null` while `SqliteStore` independently refuses to index `Scope.System`, because one forgotten argument must not make a `_keys` label findable by text. The index lives *inside* `SqliteStore` for the same reason usages do: `deleteProject`/`deleteEnvironment` are bulk SQL deletes that no decorator above the port can be atomic with, so entries would vanish while their index rows survived. `docid` is explicit because `VACUUM` renumbers the implicit rowid of a table without an `INTEGER PRIMARY KEY` — `entries` has a composite PK, so indexing `entries.rowid` would silently point the index at the wrong rows after a vacuum. External content requires the *old* text on update and delete, so the triggers use FTS5's documented `'delete'` command reading `old.*`, and the built-in `integrity-check` validates only index-vs-content — content-vs-`entries` drift needs a second, hand-written anti-join. Versioning on one input was insufficient: an `x-silo-search` edit changes the corpus without changing the tokenizer. Claims are compiled into a plan rather than passed as strings because the claim grammar is a shared-package concern and an adapter that parses it becomes a second enforcement point; targets are also the only shape that can carry the anonymous public-collection case, which no claim-derived target can express. Routing by path rather than `?project=&env=` follows D19 and fixes a failure direction: a missing query parameter would *widen* a search to the instance, bounded only by the key. A companion `POST .../search` for large filters was specified and then **rejected before implementation**: the list route already carries `?filter=<url-encoded JSON>` under the same `MaxFilterNodes`/`MaxFilterDepth` caps, and those caps are the ceiling — a worst-case filter at them measures 7,777 URL-encoded bytes, so the payload is bounded by design rather than open-ended. The two stated motives both failed inspection: URL length is already accepted on the shipped list route, and `LoggingMiddleware` logs `c.req.path` only, so search terms never reach the request log (and if they did, `?filter=` would leak identically — a logging decision, not a method one). Against those non-reasons stood real costs: a second method doubles the registrations, the request-parsing paths and the `entries:read` wiring sites at every reach, re-creating the duplicate surface that dropping `q=` from the list route had just removed; a POST-for-read is a classic place to attach a write claim by mistake; and a POST search is not linkable, which the UI depends on (filter/sort/page live in the URL so a filtered view can be shared). POST existed mainly for `populate`, which is deferred to its own decision, so adding it now would be the speculative interface D7 rejects. If the caps are ever raised past what a URL carries, the failure is loud (`414`/`431`) and that is the signal to add it then. The hit wrapper discloses scope as a deliberate exception to §5.1 — a client cannot link to a result whose location it cannot see — and the access plan already bounds it to readable targets. Media stays separate because it is instance-global with its own `media:*` claims (D23/D24); folding it into the entry index would put two authorization models in one query; the admin UI merges the two result sets into adjacent groups, which is a presentation decision and is made only there. The inline `[...]` snippet marker was specified and then **replaced before the UI consumed it**: it survives only while content contains no brackets, and a CMS body is exactly where markdown links live — the first real fixture, `See [our docs](https://silo.dev) — the new pricing page`, would have highlighted `our docs` for a search for `pricing`. Splitting the run out of the text makes the wrong answer unrepresentable rather than unlikely, and the window the server cuts stays a server concern while how much of it fits on a line stays the reader's. Rank parity between a JavaScript tokenizer and FTS5 `unicode61` is not achievable by construction (different Unicode tables), so the conformance contract is *match parity on fixtures*, stable order only for an explicit field sort, and no exposed score — measured behaviour that fixtures must pin: `foo_bar` splits on the underscore, a ULID stays one token, a URL splits into seven, diacritics fold, and CJK is **not segmented at all**, which makes `trigram` the only working tokenizer for those deployments rather than a preference. |


## 3. v1 scope

**In:** collections (JSON Schema), entry CRUD with validation, query/filter/sort/pagination, minimal admin UI with generated forms, export/import (dir or tarball), SQLite + filesystem storage adapters, Shlink-style API-key auth with capability claims, single-binary releases.

**Out (roadmap, §12):** sync engine, cache adapters, media/file uploads, drafts/publish workflow, webhooks/events, enforced relations, full-text search, auth providers, GraphQL.

## 4. Architecture

Ports-and-adapters. `core` defines domain types and interfaces and imports no adapter; adapters implement interfaces; the CLI wires them from config. Runtime-neutral behavior used by both the server and admin UI lives in the local `@silo/shared` package so protocol rules have one implementation. No `init()` registration magic — explicit construction only. Bun/TypeScript, one exported artifact (class, interface, standalone function, React component) per file, grouped into feature directories:

```
silo/
  shared/
    package.json                # local @silo/shared package boundary
    src/
      claims/                   # claim catalog + types, validation, matching, delegation, presets
      errors/                   # ValidationError, ValidationDetail (raised by shared rules)
      keys/                     # KeyFormat (secret prefix + display truncation)
      schema/                   # SiloRef, SchemaAccess (x-silo-auth), MediaField (x-silo-type)
    test/
  server/
    main.ts                    # thin entrypoint: imports Cli, runs it
    cli/
      cli.ts                   # argv parsing, subcommand routing, dependency wiring
      commands/                # serve-command.ts, keys-command.ts, export-command.ts, import-command.ts
    config/                    # Config + sub-shapes (incl. LogConfig), ConfigLoader
    logging/                   # Logger, LogLevel(s), LogSink + ConsoleSink/FileSink,
                               #   LogLocation, LogTail
    runtime/                   # Process lifecycle (D25): RunState, RunFile, Daemon,
                               #   ListenAddress
    core/
      domain/                  # Entry, Meta, EntryUtils, Collection, Scope
      ports/                   # Storage, BlobStorage interfaces
      query/                   # Filter, SortKey, Query, QueryUtils
      errors/                  # NotFoundError, ConflictError, UnauthorizedError, ForbiddenError
      schema/                  # SchemaValidator, SchemaBundler, RemoteSchemaLoader
      keys/                    # KeyInfo, KeyUtils
      media/                   # MediaMetadata, MediaResolver, MimeUtils
      transfer/                # FormatVersion, Exporter, Importer, ImportWalker
      service/                 # Service, KeyView, AsyncMutex, CollectionEraser
    adapters/
      storage/sqlite/          # SqliteStore, SqliteCompiler
      storage/fs/               # FsStore, FsFilter, FsManifest
      blob/                    # FsBlobStorage, S3BlobStorage, BlobStorageFactory
      http/                    # HttpSiloClient (direct-copy source client)
    http/
      server.ts                # SiloServer — builds the Hono app
      middleware/               # LoggingMiddleware, AuthMiddleware
      auth/                     # RouteAuth
      routes/                   # RouteManager + one routes class per resource
    test/                      # bun test suites: conformance/, adapters/, core/, http/
  ui/
    src/
      api/                     # ApiClient, ApiError, EntryMapper, DTOs under api/types/
      schema/                  # SiloRefs ($ref resolution for RJSF)
      components/              # Shared visual primitives (SiloMark, Modal, Toast, ...)
      forms/                   # RJSF theme: templates/, widgets/, fields/, build-ui-schema.ts
      router/                  # Routes, Route/ServerRoute types, router, Link
      styles/                  # Tokens, reset, and deliberately shared page/form/feedback utilities
      utils/                   # Formatters
      views/                   # Feature views with colocated *.module.css files
  IMPLEMENTATION.md
```

The export/import engine lives in `server/core/transfer/` and speaks only through the `Storage` interface — that is what makes cross-adapter migration (export from SQLite, import into fs) automatic.

## 5. Core concepts

### 5.1 Entries and the envelope

An entry is user data (`data`) wrapped in a silo-owned envelope. Since D18, a
collection is identified by `(project, env, collection)`, not name alone, so
the envelope carries the scope alongside the collection name it already
carried:

```go
type Entry struct {
    ID         string          `json:"id"`          // ULID
    Project    string          `json:"project"`     // scope; "_system" for silo-reserved data
    Env        string          `json:"env"`         // scope; "_system" for silo-reserved data
    Collection string          `json:"collection"`
    Rev        int64           `json:"rev"`         // per-entry, increments on every write
    Seq        int64           `json:"seq"`         // per-instance monotonic write counter, global across every scope
    CreatedAt  time.Time       `json:"created_at"`  // RFC3339, UTC
    UpdatedAt  time.Time       `json:"updated_at"`
    Data       json.RawMessage `json:"data"`
}
```

- `rev` enables optimistic concurrency (§8) and merge conflict resolution (§7.2).
- `seq` is the hook for a future change feed (§12.1). It costs nothing now and avoids a storage redesign later. It stays instance-global rather than per-scope, so a single cursor still orders every write in the instance.
- Timestamps are always UTC RFC3339 with millisecond precision.
- `project`/`env` follow the same id grammar as collection names
  (`^[a-z][a-z0-9_-]{0,63}$`), defined once on the `Scope` value object
  (`server/core/domain/scope.ts`, D18). `Scope` is a plain (project, env) pair
  with no metadata and no registry — see D18 and §6.1.
- `EntryUtils.toApiResponse` never leaks `project`/`env` into the HTTP
  response, exactly like `collection` and `seq`: scope is a storage/domain
  concern, invisible to the API. `rev` **is** returned (2026-08-20), because
  §8 requires it back as `If-Match`/`?rev=` — a client that never sees a
  revision can only guess one, which succeeds exactly once per entry and then
  `409`s on every later write. A user field named `rev` is dropped from the
  data the same way `id` already was, so the envelope value cannot be
  shadowed.

### 5.2 Collections & schemas (full JSON Schema)

A collection = a name + a JSON Schema draft 2020-12 document. Schemas are stored *through the storage adapter* (so the UI can edit them) and exported as plain files (so git workflows work).

**Validation** — full spec compliance via `github.com/santhosh-tekuri/jsonschema/v6` (complete 2020-12 support). Compiled validators are cached in memory, invalidated on schema update.

**`$ref` policy** — refs resolve only against: (a) the same document (`#/$defs/...`), (b) other collections in this instance via `silo://collections/<name>`. **Remote http(s) refs are rejected by default** (opt-in via config) — network fetching during validation is a determinism and security hazard, and would break offline imports.

**Form rendering** — RJSF handles most of the spec (including `oneOf`/`anyOf`/`$ref`), but full JSON Schema is not fully renderable as a form. Policy: RJSF renders what it can; for constructs it can't, the UI falls back to a **raw JSON editor with live validation** for that subtree. Validation is always authoritative server-side regardless of what the form allowed.

**Schema changes vs existing data** — validation happens **on write only** (lazy). Changing a schema never blocks on or rewrites existing entries; entries that predate a schema change may no longer validate and will be flagged in the UI when opened. A `silo validate` command (roadmap) can sweep a collection on demand. This is the only sane policy under a document model with replayable imports.

`x-silo-*` extension keywords are reserved for silo (UI hints like field ordering/widgets, future relation semantics). Unknown `x-silo-*` keys are preserved, never stripped.

### 5.3 Query AST and paths (D29)

Queries are a small structure, not a string language. Every op added must be implemented by every adapter forever, so the set is deliberately minimal. Since D29 the *addressing* half is not silo's own invention either: fields are **RFC 9535 JSONPath** expressions.

```json
{ "op": "and", "args": [
    { "op": "eq",     "path": "$.data.tags[*]",   "value": "cms" },
    { "op": "gte",    "path": "$.updated_at",     "value": "2026-01-01" },
    { "op": "not",    "args": [ { "op": "exists", "path": "$.data.archived_at" } ] }
] }
```

A query is that filter plus `sort` (paths with an optional `-` prefix for descending), `limit` (default 50, max 500) and `offset`.

**Operators.** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains` (leaf); `exists` (leaf, no value); `not` (exactly one arg); `and`, `or`. `contains` is **string substring only** — array membership is `eq` over a `[*]` path, which is why no operator needs an array branch.

**The path subset is closed.** Root `$`, name selector, array index (negative included), child wildcard `[*]` and `.*`. Recursive descent, slices, index unions, filter selectors, function extensions and script expressions are **refused** by the parser, not ignored. Excluding recursive descent is what keeps `json_tree()` — a full-subtree walk — out of the SQL compiler; `json_each()` covers the child wildcard far more cheaply.

**The root is a virtual entry document.** Paths address `{ id, rev, created_at, updated_at, data }`:

| Path | Addresses |
|---|---|
| `$.id`, `$.rev`, `$.created_at`, `$.updated_at` | the envelope fields the API returns |
| `$.data.author.name`, `$.data.items[0]`, `$.data.items[-1]` | singular paths into user data |
| `$.data.tags[*]`, `$.data.meta.*` | wildcard paths, zero or more nodes |

The envelope half is exactly what `EntryUtils.toApiResponse` exposes; user fields sit under `$.data` rather than flattened as the wire response has them, so a user field named `id` can never shadow the envelope's. `project`, `env`, `collection` and `seq` are unaddressable because the API hides them (§5.1) — derived from one rule, not restated as a second allow-list. An envelope field is a scalar and takes no further selectors: `$.id[0]` is a parse error, not an empty result. The pre-D29 spellings (`author.name`, `$id`) are gone, with no shim and no detection.

**Cardinality is part of the contract.** A singular path selects zero or one node; a wildcard path selects zero or more. A leaf op is true when **any** selected node satisfies it. **ANY over zero nodes is false — for every op, `neq` included.** `exists` is true when the path selects at least one node. `not` negates the completed child predicate. Sort accepts singular paths only, since a wildcard has no deterministic order.

Two consequences worth stating outright, because both look like the other:

| Written | Means |
|---|---|
| `neq($.data.tags[*], "x")` | at least one tag is not `"x"` |
| `not(eq($.data.tags[*], "x"))` | no tag is `"x"` |

and "absent, or not equal" is now explicit: `or(not(exists(p)), neq(p, v))`. Pre-D29, `neq` on a missing field returned true; it returns false now.

**One parser, three consumers.** The path AST and parser live in `shared/src/query/path/` because the admin UI (filter builder), the query validator and both engines must agree on what a path means. The `Filter` node and the closed operator list (`shared/src/query/filter.ts`, `filter-ops.ts`) live there for the same reason and are read by the same three: an op the UI offers but the validator refuses would be a `400` the reader cannot act on, and the only way that cannot happen is for the menu and the validator to read one list. Only the SQL compiler is adapter-local. SQLite compiles a singular path to `json_extract(data, '$.a.b')` and a wildcard to `EXISTS (SELECT 1 FROM json_each(data, '$.items') WHERE …)`; the fs adapter walks the same AST in memory. `exists` on a singular path is `json_type(data, '$.p') IS NOT NULL`, which distinguishes JSON `null` (exists) from absent. `not` compiles to `NOT COALESCE(<cond>, 0)` and never to a bare `NOT`: SQL three-valued logic drops NULL rows, so a bare `NOT` disagrees with the in-memory evaluator on exactly the missing fields a negation is usually asked about.

### 5.5 Search (D30)

Search is a separate port, not an operator. §5.3's "every op is forever" rule is the reason: an FTS operator would oblige every future adapter to reproduce relevance ranking, whereas a port lets each answer with what it has.

```
Searcher.search(request, access)   ->  { data: hit[], total, limit, offset, truncated, engine }
Searcher.reindex(target?)          ->  report
Searcher.capabilities()            ->  { engine: "fts5" | "scan", snippets }
```

Two implementations. **`ScanSearcher`** works on every adapter by reading entries and matching in memory — O(N), the character §6.3 already commits the fs adapter to. **`SqliteSearcher`** uses FTS5. The portable one ships first, so search exists everywhere and FTS5 makes it fast rather than possible. It stops at a visit cap **and** a time budget, reporting `truncated` — a count cap alone is not enough, because one collection of very large documents exhausts a request's patience well before its entry count. Both are checked per entry rather than per page, or a single page could overrun the cap by its whole size. FTS5 is probed at open inside a savepoint; a build without it falls back to the scan engine and logs once, because the shipped SQLite sets `OMIT_LOAD_EXTENSION` and no runtime repair is possible.

**What gets indexed** is derived by the caller — the extractor needs the schema, the adapter must not have it. It reaches an adapter through the port (`Storage.put(e, { usages, search })`), exactly as media usages do (D23), from the point an engine actually stores it; `ScanSearcher` extracts at query time and needs no stored text. An `x-silo-search` keyword at the schema root selects the text with D29 paths:

```json
"x-silo-search": {
  "label":   ["$.data.title"],
  "include": ["$.data.blocks[*].text"],
  "exclude": ["$.data.internal_notes"]
}
```

`label` is the high-weight bucket (`bm25(fts, 10.0, 1.0)`); `include`, when present, becomes an allow-list that replaces the default; `exclude` subtracts. With the keyword absent the default is every string leaf under `$.data` and an empty `label`. Paths are validated when the schema is saved, so a typo is a `400` rather than a field that quietly leaves the index. `exclude` is **not** an access control — it keeps text out of the index, and a read of the entry still returns the field.

**Authorization is a plan, not a claim string.** The service compiles the key's `entries:read` claims — plus public collections, whose public-ness lives in the schema and which no claim-derived target can express — into a `SearchAccess` list of concrete targets. The engine applies it **before** rank, count and paging, so `total` and paging are correct rather than post-filtered. Adapters parse no claims.

**Routes** follow D19: the reach is in the path, never in a query parameter.

| Reach | Route |
|---|---|
| collection | `GET /api/projects/{p}/envs/{e}/collections/{name}/search` |
| scope | `GET /api/projects/{p}/envs/{e}/search` |
| instance | `GET /api/search` |

Each carries `q`, `filter`, `sort`, `limit`, `offset` and maps to `entries:read`. `GET` is the only method: `filter` is the same url-encoded JSON the list route already accepts, bounded by the same `MaxFilterNodes`/`MaxFilterDepth` caps (worst case 7,777 encoded bytes), so a request body buys nothing and would cost a duplicate surface, a second claim-wiring site, and a search that cannot be linked to. Both scoped routes register under `/envs/` and `/environments/`, and all of them register **before** the entry routes — Hono matches in registration order, so `/collections/{name}/search` would otherwise be captured as an entry whose id is `"search"`. A given `sort` wins and relevance is ignored; no `sort` with a non-empty `q` gives relevance order; neither gives `-$.updated_at`. `q` is optional, so at the collection reach a filter-only `/search` returns the same set as the list route in a different shape — a documented overlap, since the wider reaches need filter-only queries and a special rule at one reach would be arbitrary.

A hit discloses its location on the wrapper, never on the entry:

```json
{ "project": "acme", "env": "prod", "collection": "posts",
  "entry":    { "id": "01J8…", "rev": 2, "title": "Pricing" },
  "snippets": [ { "path": "$.data.body",
                  "before": "…our ", "match": "pricing", "after": " page…" } ] }
```

This is a deliberate exception to §5.1: a client cannot link to a result whose location it cannot see, and the access plan already bounds the disclosure to readable targets. No numeric relevance score is exposed, because two engines rank the same matches differently.

A snippet is **three strings, not one with markers in it** — the fragment is `before + match + after`. Marking the matched run up inline (`"…our [pricing] page…"`) reads well in a terminal and is ambiguous everywhere else: a body holding a bracket of its own, which any markdown link does, gives a highlighter two candidate pairs and no way to choose. Escaping would make every consumer learn an escape rule; offsets would make them agree on what a character is. Three strings need neither.

**Media stays out of the entry index.** It is instance-global with its own `media:*` claims (D23/D24), and folding it in would put two authorization models in one query. The admin UI merges the two result groups; the server does not.

**Engines report themselves.** Every search response carries `engine`, so a client can tell an indexed answer from a scanned one, and `silo search reindex` says plainly when there is no index to rebuild rather than reporting a silent success.

**Index state** (SQLite) is `entry_search_documents` — an explicit `docid INTEGER PRIMARY KEY`, never `entries.rowid`, because `VACUUM` renumbers the implicit rowid of a table whose primary key is composite — plus an external-content `entry_search_fts`. Triggers maintain it inside the transactions that already exist in `put`, `delete`, `deleteProject` and `deleteEnvironment`, and the update and delete triggers use FTS5's documented `'delete'` command reading `old.*`, since external content needs the *old* text to remove its terms. Versioning covers four inputs: engine, FTS schema and tokenizer configuration globally, extractor version and the per-collection `x-silo-search` hash locally. A global change rebuilds everything before the bind; a schema change rebuilds one collection. `silo search reindex [--check]` runs **two** integrity checks — FTS5's built-in one validates the index against the document table only, so content-versus-`entries` drift needs a second anti-join, in both directions (a document with no entry, and an entry with no document). `POST /api/search/reindex` is the same operation over HTTP and asks for the instance-wide read authority an export does: rebuilding reads every entry in the instance, so a narrow key must not become a way to make all of it searchable.

**Parity is by fixture, not by construction.** SQLite's Unicode tables and the JavaScript engine's are different, so the conformance contract is that the same fixtures match in both engines, that stable order is required only for an explicit field sort, and that relevance order and snippet text are engine-specific. Measured under `unicode61 remove_diacritics 2`: `foo_bar` splits on the underscore, a ULID stays one token, `https://silo.dev/a/b?x=1` splits into seven, `Café` folds to `cafe` — and `日本語のテキスト` is **one token**, because unicode61 does not segment CJK. Those deployments must select the `trigram` tokenizer; it is not a preference.

`format_version` does not change. The index is derived, lives only in SQLite, and never enters an export, so the frozen fs layout (D5) is untouched.

### 5.4 System collections

Collection names starting with `_` are reserved for silo. They flow through the same `Storage` interface and use the same envelope, but are hidden from collection listings, the UI sidebar, and exports (unless explicitly included). User schemas may not claim a `_` name. System collections exist once per instance.

Since D18, the same reservation applies one level up: project and env ids
starting with `_` are reserved for silo, exactly like collection names. In
practice this reservation is enforced by construction rather than an explicit
check — `Scope`'s id grammar requires a lowercase first character, so no
caller-supplied id can ever start with `_`. The one reserved scope,
`Scope.System` (`_system`/`_system`), is built through a private constructor
that bypasses that validation.

v1 has three system collections, all living in `Scope.System`: **`_keys`** (§8), and — since D23 — **`_media`** and **`_media_folders`** (§8.1). Reusing the doc model here means adapters, the export engine, and the conformance suite cover system data with no extra code — the reserved scope is stored exactly like any other, with no special-cased path in any adapter. (D19 added a second, `_projects`, to record scopes declared but not yet filled; D20 replaced it with first-class project/env storage and it no longer exists.)

None of them has a schema, so they never appear in `ListSchemas` and have to be reachable wherever content collections are enumerated (`Exporter`, and `Storage.ListEntryCollections` for the general case). `_keys` is a credential, so it stays behind `--with-keys`; `_media` and `_media_folders` are ordinary data and are **always** exported, because an archive that carried media bytes but not their filenames and folders would restore a library with no organization in it. An empty project needs no collection of its own to survive a round trip: since D20 it exists as a stored project/env record, `listScopes()` reports it, and the archive carries it as a bare `projects/<p>/<e>/` directory.

## 6. Storage adapters

### 6.1 Interface

```go
type Storage interface {
    // Schemas — scoped to (project, env) since D18
    PutSchema(ctx context.Context, scope Scope, collection string, schema json.RawMessage) error
    GetSchema(ctx context.Context, scope Scope, collection string) (json.RawMessage, error)
    ListSchemas(ctx context.Context, scope Scope) (map[string]json.RawMessage, error)
    DeleteSchema(ctx context.Context, scope Scope, collection string) error // fails if entries exist, unless forced at a higher layer

    // Entries — Put is create-or-replace; caller sets envelope (scope included),
    // adapter assigns Seq. Get/Delete/List take scope explicitly.
    //
    // `usages` is the entry's COMPLETE set of media reference tokens (D23),
    // extracted by the caller with MediaRefs.Extract and replaced wholesale
    // in the same operation as the write. It is required, not optional: an
    // omitted set has no safe reading — "clear" orphans a live reference,
    // "leave" rots the index — so forgetting it must not compile.
    Put(ctx context.Context, e *Entry, usages []string) error
    Get(ctx context.Context, scope Scope, collection, id string) (*Entry, error)
    Delete(ctx context.Context, scope Scope, collection, id string) error
    List(ctx context.Context, scope Scope, collection string, q Query) ([]*Entry, int /*total*/, error)

    // Every non-system scope currently holding a schema or an entry, sorted by
    // (project, env). Scope existence is derived from content, never registered.
    ListScopes(ctx context.Context) ([]Scope, error)

    // Media usages (D23). Derived state owned by the adapter: SQLite keeps a
    // media_references table written inside Put's existing transaction, the fs
    // adapter scans entry files and stores no index. Delete/DeleteProject/
    // DeleteEnvironment drop matching usages as part of the same operation.
    ListMediaUsages(ctx context.Context, mediaIDs []string, limit, offset int) ([]MediaUsage, int /*total*/, error)
    CountMediaUsages(ctx context.Context, mediaIDs []string) (map[string]int, error)

    // Every collection in this scope that still holds an entry, sorted by name.
    // Deliberately distinct from ListSchemas: an archive can carry
    // content/<collection>/ with no schema, and those entries are invisible to
    // every schema-derived listing — without this the scope they live in can
    // never be emptied.
    ListEntryCollections(ctx context.Context, scope Scope) ([]string, error)

    // Instance metadata (instance_id, last_seq). seq stays instance-global and
    // monotonic across every scope.
    Meta(ctx context.Context) (Meta, error)

    Close() error
}
```

Seq assignment lives in the adapter because it must be atomic with the write. A future `Changes(sinceSeq)` method will be introduced as an *optional* interface (`interface{ Changes(...) }` upgrade check) so v1 adapters don't have to implement it.

Adapters assume **one process owns a data directory**, which is enforced above
them at the process boundary rather than by any of them (D25): `Storage` has no
cross-process lock, the fs adapter holds `last_seq` in memory, and `Service`'s
write mutex is process-local. `RunFile.assertNotRunning` is what makes that
assumption true.

Rules for all adapters: single-writer semantics per entry, atomic writes (no torn entries observable), `List` results stable-ordered (sort keys, then `id`), the project/env existence rule of D20 (created explicitly *or* still holding content — a scope reported by one adapter and not the other is a portability bug, since `Exporter` enumerates `listScopes()`), and **`project`/`env`/`collection`/`id` validated as safe path segments** (`EntryUtils.assertSafeSegment`: non-empty, not `.`/`..`, no `/`, `\`, or NUL, ≤255 bytes) on every entry call. That last rule is a port contract rather than one adapter's local defense: the fs adapter turns these values into a path, so an unvalidated `id` from an import archive could otherwise plant an entry outside its scope or outside the data dir entirely — and a cap the fs adapter can't honor would let SQLite accept what fs rejects mid-write with `ENAMETOOLONG`. Both adapters therefore reject the same values, and the conformance suite pins that. Since D18, `$ref`/`$defs` resolution, the compiled-validator cache, and referrer checks (§9) are likewise scoped — the same collection name in two scopes never shares a validator or resolves a ref against the other's schemas.

### 6.2 SQLite adapter

```sql
CREATE TABLE meta    (key TEXT PRIMARY KEY, value TEXT NOT NULL); -- instance_id, last_seq, format_version
CREATE TABLE schemas (
    project    TEXT NOT NULL,
    env        TEXT NOT NULL,
    collection TEXT NOT NULL,
    schema     TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project, env, collection)
);
CREATE TABLE entries (
    id         TEXT NOT NULL,
    project    TEXT NOT NULL,
    env        TEXT NOT NULL,
    collection TEXT NOT NULL,
    rev        INTEGER NOT NULL,
    seq        INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data       TEXT NOT NULL,           -- JSON
    PRIMARY KEY (project, env, collection, id)
);
CREATE INDEX idx_entries_seq ON entries(seq);
CREATE TABLE media_references (          -- D23; derived, rebuilt by `silo media reconcile`
    media_id   TEXT NOT NULL,            -- asset ULID, or "blob:<key>" for a pre-D23 reference
    project    TEXT NOT NULL,
    env        TEXT NOT NULL,
    collection TEXT NOT NULL,
    entry_id   TEXT NOT NULL,
    PRIMARY KEY (media_id, project, env, collection, entry_id)
);
CREATE INDEX idx_media_refs_entry ON media_references(project, env, collection, entry_id);
CREATE TABLE entry_search_documents (   -- D30; derived, rebuilt by `silo search reindex`
    docid      INTEGER PRIMARY KEY,     -- explicit: VACUUM renumbers an implicit rowid
    project    TEXT NOT NULL,
    env        TEXT NOT NULL,
    collection TEXT NOT NULL,
    entry_id   TEXT NOT NULL,
    label      TEXT NOT NULL,           -- weighted text (x-silo-search.label)
    body       TEXT NOT NULL,
    UNIQUE (project, env, collection, entry_id)
);
CREATE INDEX idx_entry_search_scope ON entry_search_documents(project, env, collection);
CREATE VIRTUAL TABLE entry_search_fts USING fts5(  -- external content; 3 sync triggers
    label, body, content = 'entry_search_documents', content_rowid = 'docid',
    tokenize = '<[search] tokenizer>'
);
```

`media_references` and `entry_search_documents` rows are written inside `put`'s existing transaction — the
one that already allocates `seq` — so an entry, its references and its index row land together
or not at all. `delete`, `deleteProject` and `deleteEnvironment` drop matching
rows in their own transactions for the same reason.

The search tables exist only when `[search] enabled` is true **and** the SQLite build has FTS5, which is probed at open rather than assumed. `docid` is an explicit `INTEGER PRIMARY KEY` because `VACUUM` renumbers the implicit rowid of a table whose primary key is composite, which would silently point the index at the wrong rows; the upsert uses `ON CONFLICT DO UPDATE` so it survives a rewrite. Opening with search **disabled** clears the version stamp but drops nothing — every CLI subcommand opens the store, so a `silo keys list` from a build without FTS5 would otherwise delete the index a running server is maintaining on the same data dir, and a cleared stamp already forces the rebuild that correctness needs.

WAL mode, `busy_timeout` set, one write connection + a read pool. `seq` allocated by incrementing `meta.last_seq` inside the write transaction, still instance-global rather than per-scope. Filters compile to `json_extract(data, '$.path')` expressions; no per-field indexes in v1 (roadmap: expression indexes for declared hot fields). Scope values (`project`, `env`) always reach SQL as bound parameters, never interpolated, same as every other query value. `SqliteStore.open` refuses to open a data dir stamped with a different `format_version` before running DDL — `CREATE TABLE IF NOT EXISTS` would otherwise silently leave a pre-D18 schema/entries table without these columns in place, so unscoped queries would crash on "no such column" instead of failing with an actionable message. The `meta.format_version` row is checked first, but isn't trusted alone: a pre-D18 db could in principle have old-shaped tables without a `format_version` row to contradict, so the guard also inspects `schemas`/`entries` directly via `PRAGMA table_info` and refuses to open if either exists without a `project` column.

### 6.3 Filesystem adapter (layout = export format, per D5)

Since D18 (`format_version` `"2"`), every collection lives under its
`(project, env)` pair:

```
<data-dir>/
  manifest.json                     # format_version, instance_id, last_seq
  projects/
    <project>/
      <env>/
        schemas/
          posts.schema.json         # the JSON Schema document, pretty-printed
        content/
          posts/
            01J8XQ4Z8K9M2P3R5T7V9X1B3D.json
    _system/
      _system/
        content/
          _keys/                   # system collections live in the reserved scope
            01J8XQ50P1R2S3T4U5V6W7X8Y9.json
```

The reserved system scope (`_system/_system`) is just another `<project>/<env>` pair — the adapter has no branch for it. `listScopes()` walks the `projects/*/*` directory pairs, skips any whose names start with `_`, and reports a pair only if it still holds a schema or an entry — a directory left behind by deleting a scope's last collection is not a scope. Scope existence is derived from content on every adapter, never registered.

Each entry file is the full envelope, pretty-printed with a fixed field order — every write serializes the same envelope shape in the same order, so diffs stay minimal (git-diff-friendly), though it's insertion order, not alphabetical. The `project`/`env`/`collection` fields carry the scope and collection name but are **not** trusted on read: `get`/`list` always take `project`/`env` from the scope that was queried (the directory the file was found under), and import takes both from the archive path — the path is the addressing authority, not the file's own contents. This also closes a concrete bug class: an envelope that disagreed with its path could otherwise make a later write fork the entry into the wrong scope.

```json
{
  "id": "01J8XQ4Z8K9M2P3R5T7V9X1B3D",
  "project": "acme",
  "env": "prod",
  "collection": "posts",
  "rev": 3,
  "seq": 142,
  "created_at": "2026-07-03T14:00:00.000Z",
  "updated_at": "2026-07-03T15:30:00.000Z",
  "data": { "title": "Hello" }
}
```

Writes are `O_TMPFILE`-style: write to `.<id>.json.tmp`, fsync, rename. `manifest.json` is rewritten (same tmp+rename) after each write to persist `last_seq`; on startup the adapter verifies `last_seq >= max(seq)` found on disk (now recursing through the whole `projects/` tree) and repairs the manifest if the process died between the two writes. Listing = read directory (names are ULIDs, so lexical order = creation order), filter in memory. This is O(n) per query — acceptable and documented; the fs adapter's job is workflow (git, rsync), not throughput.

**Frozen-format consequence (accepted in D5):** no sharded directories, no on-disk indexes, no binary formats — ever — without a `format_version` bump and migration tooling. Pre-1.0, that bump itself is cheap: D18 broke the layout outright (flat → `projects/<p>/<e>/...`) with no migration path, matching the project's pre-1.0 stance that breaking changes are expected rather than shimmed. `FsStore.open` refuses a data dir stamped with a different `format_version` rather than misreading it as the new tree.

## 7. Export / import

### 7.1 Formats

- `silo export --dir <path>` writes the §6.3 tree — every scope that holds content, plus `_system` when `--with-keys` is set (the `--with-keys` rule for `_keys` is otherwise unchanged; scope-filtered export, e.g. `--project`/`--env`, is a later phase — export today is always instance-wide).
- `silo export --out <file>.tar.gz` writes the same tree as a tarball, entries ordered by (collection, id) so archives are reproducible byte-for-byte given identical data.
- If the running instance already uses the fs adapter, export is effectively a copy — and users can skip export entirely and `rsync` the data dir.

`manifest.json` in an export additionally records: `exported_at`, `silo_version`, and per-collection entry counts — since D18, `collections` is keyed by `"<project>/<env>/<collection>"` rather than by bare collection name, so the same name in two scopes gets two independent counts.

- `--with-config` includes `config.json` (sanitized: no secrets/tokens). Default **off** — config is instance-specific (ports, paths).
- `_keys` is excluded by default. `--with-keys` includes it — hashes only, so a cloned instance accepts the same secrets. Useful for true replicas; off by default so a content export handed to someone never ships credentials. Projects and envs that hold nothing yet are addressing, not credentials, and are never gated: `listScopes()` reports them (D20), and they ride along as empty `projects/<p>/<e>/` directories, so the project list is not the one thing an export cannot reproduce.
- Export runs through the `Storage` interface, so it works identically on any adapter. It streams (no full-dataset buffering) and is also exposed as `GET /api/export` (`transfer:export`) returning the tarball.
- `media/` stays a top-level directory in the archive, unaffected by scoping — media is instance-global (§8.1), not per-project/env. Since D23 the bytes travel with their catalog: `_media` and `_media_folders` ride in `_system` and are **never** gated on `--with-keys`, because filenames and folders are data, not credentials. Blob keys stay flat, so the directory layout is unchanged.

### 7.2 Import

`silo import <dir|tarball> [--mode merge|replace] [--validate]` (also `POST /api/import`, admin).

- The importer walks `projects/<project>/<env>/{schemas,content}` (`ImportWalker`, since D18) rather than a single flat `schemas/`+`content/` pair. The scope comes from the path — an entry's `project`/`env` fields are set from the directory it was found in, not trusted from the file's own contents, so the path is the addressing authority.
- **`replace`** — for each `(scope, collection)` pair present in the archive: delete the local collection (schema + entries) **in that scope only**, then load. A same-named collection in a different scope is untouched, and pairs absent from the archive are untouched.
- **`merge`** (default) — match by `(scope, collection, id)`. Missing locally → insert. Present both sides → **newest `updated_at` wins** (tiebreak: higher `rev`, then lexically greater source instance_id — deterministic on both sides). `--prefer local|remote` overrides. Schemas merge the same way using their `updated_at`.
- Imported entries keep their `id`, `rev`, timestamps, and scope (`project`/`env` from the path). `seq` is **reassigned locally** (seq is per-instance, never portable).
- The importing instance **keeps its own `instance_id`** — cloning data does not clone identity.
- **Validation off by default** on import: fidelity first — the source instance accepted this data, possibly under an older schema. `--validate` opts into strict checking; it validates each entry against its own scope's schema.
- The `_keys` guard is scope-aware only in the sense that it looks for `_keys` under any scope in the archive — an archive containing `_keys` anywhere still requires the importing key to hold `keys:import` (`ForbiddenError` otherwise), same as before D18.
- **Legacy archives** — not applicable pre-1.0: an unrecognized `format_version` is rejected outright (§6.2/§6.3), never migrated. D18 bumped the format to `"2"` with no dual-format reader.
- **Imports are not atomic.** There is no transaction spanning the walk: an archive that fails partway (a rejected path segment per §6.1, a disk error) leaves everything written up to that point in place, and the caller gets the error instead of an `ImportResult`, so the counts of what landed are lost. Failing loudly mid-import is the deliberate trade against the alternative — accepting malformed addressing to keep the run going — but it means a failed import must be treated as "unknown state, re-run or restore", not "no-op". `--dry-run` walks and reports without writing, which is the way to check an untrusted archive first. Atomic import would need either a staging area or a transactional `Storage` method, neither of which exists pre-1.0.

### 7.3 Direct server copy

`POST /api/copy` (`transfer:copy`) pulls `/api/export` from another running silo and feeds
that archive to the same importer used by file uploads. The request supplies the
source base URL, a source API key with `transfer:export`, merge/replace mode, dry-run, conflict
preference, and whether `_keys` should be included. Schemas, entries, and media
are always copied. Source credentials are used only for the outbound export
request and are not stored on the destination.

Data-only copy excludes `_keys`, preserving destination access. Data-plus-keys
merge adds/updates source key hashes; replace removes destination keys before
loading the source keys. After a replace-with-keys operation, the supplied
source key is therefore the credential that can access the destination.
Including `_keys` requires `keys:export` on the source and `keys:import` on the
destination.

### 7.4 Cross-adapter migration

Because export/import speak only `Storage`, migrating backends is: `silo export` on the old instance, `silo import --mode replace` on the new one. This doubles as the acceptance test for every new adapter.

### 7.5 Known limitation: deletions don't merge

v1 has no tombstones, so a deletion on instance A is not propagated by merging A's export into B — only `replace` mode reflects deletions. Documented loudly. Tombstones arrive with the sync design (§12.1).

## 8. HTTP API

Hono web framework on Bun. JSON everywhere. Admin UI served at `/`; API under `/api` — no URL versioning (D13): breaking API changes are release-note events tied to binary upgrades, and the data format is versioned independently via `format_version`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | liveness + version |
| GET | `/api/session` | authenticated key label, prefix, and effective claims |
| GET / POST | `/api/projects` | list scopes (filtered by claims) / create scope (`{project, env}`) |
| DELETE | `/api/projects/{project}/envs/{env}` | delete scope and its collections (`?force=true`) |
| GET / POST | `/api/projects/{project}/envs/{env}/collections` | list / create (body: `{name, schema}`) |
| GET / PUT / DELETE | `/api/projects/{project}/envs/{env}/collections/{name}/schema` | schema fetch / update / delete |
| GET / POST | `/api/projects/{project}/envs/{env}/collections/{name}` | list (query below) / create |
| GET / PUT / DELETE | `/api/projects/{project}/envs/{env}/collections/{name}/{id}` | PUT is full replace |
| GET | `/api/projects/{project}/envs/{env}/collections/{name}/search` | search one collection (§5.5) |
| GET | `/api/projects/{project}/envs/{env}/search` | search one scope |
| GET | `/api/search` | search the instance |
| POST | `/api/search/reindex` | rebuild the index; export-level read claims |
| GET | `/api/export` | streams tar.gz (`transfer:export` + `media:read`; `keys:export` when including keys) |
| POST | `/api/import?mode=` | accepts tar.gz (`transfer:import` + `media:create`, plus `media:delete` in replace mode; archives containing keys also require `keys:import`) |
| POST | `/api/copy` | pulls and imports another silo (`{source_url, source_api_key, mode, with_keys, dry_run, validate, prefer}`; `transfer:copy`) |
| GET / POST | `/api/keys` | list (`keys:read`) / create (`keys:create`); create returns the secret exactly once |
| DELETE | `/api/keys/{id}` | revoke a key (`keys:revoke`) |
| GET / POST | `/api/media` | search (`media:read`) / upload (`media:create`) — see §8.1 |
| GET / PATCH / DELETE | `/api/media/{id}` | asset detail / rename·move·retag (`media:create`) / guarded delete (`media:delete`) |
| GET | `/api/media/{id}/usages` | paginated referrers, claim-filtered (`media:read`) |
| GET / POST | `/api/media/folders` | list / create an empty folder (`media:read` / `media:create`) |
| DELETE | `/api/media/folders` | delete an empty folder (`media:delete`) |
| POST | `/api/media/reconcile` | backfill and repair the catalog (`media:create` + `media:delete`) |
| GET | `/media/{id}` | public asset streaming (pre-D23 `/media/{blobKey}` still resolves) |

**List query encoding:** `?filter=<url-encoded JSON Filter>&sort=-$.updated_at,$.data.title&limit=50&offset=0`. Since D29 both `filter` paths and `sort` keys are RFC 9535 JSONPath over the API response shape (§5.3); the pre-D29 `author.name` / `$id` spellings are rejected. Response: `{"data": [...], "total": n, "limit": ..., "offset": ...}`. The search routes (§5.5) take the same `filter`, `sort`, `limit` and `offset`, plus `q`.

**Optimistic concurrency:** PUT/DELETE require the expected rev (`If-Match: "3"` or `?rev=3`); mismatch → `409` with the current entry. Prevents lost updates from two admin tabs — cheap now, painful to retrofit.

**Errors:** `{"error": {"code": "validation_failed", "message": "...", "details": [...]}}`; validation details use JSON Pointer paths from the validator.

**Auth: claims-based API keys, Shlink-style.** No users or browser sessions: a presented key authenticates a request and its claims authorize individual operations. Claims are deny-by-default. Anonymous collection schema and entry reads remain public within their scope unless the schema sets `"x-silo-auth": true`. When a key is presented, its claims become the visibility boundary and even public collections require the corresponding read claim.

- **Format & storage:** `silo_` + 32 random bytes base64url. Only the SHA-256 hash is stored, as an entry in the `_keys` system collection (§5.4) with label, validated `claims` array, display prefix (`silo_ab12…`), and the usual envelope. Lookup = hash the presented key, exact-match fetch. The plaintext secret exists only in the creation response.
- **Claims:** root `*`; `collections:<project>/<env>/<name>:create|delete|schema:read|schema:update|access:update|entries:create|entries:read|entries:update|entries:delete`; `media:read|create|delete`; `keys:read|create|revoke|export|import`; and `transfer:export|import|copy`. Each segment (`project`, `env`, `name`) independently supports `*` wildcards (e.g. `collections:acme/*/*:entries:read`, `collections:*/prod/*:...`). Action wildcards are invalid.
- **Non-escalating delegation:** `keys:create` permits minting a key only when every requested claim is already covered by the caller. A segment wildcard can delegate matching named segments; named segments cannot widen to wildcards.
- **No legacy translation:** stored role/collection-allowlist key records are rejected rather than upgraded implicitly.
- **Presets:** `read`, `write`, `manage`, `root` — a ladder, each including the one before it. `read` is `schema:read` + `entries:read`; `write` adds the three entry mutations; `manage` adds collection lifecycle (`create`, `schema:update`, `access:update`, `delete`); `root` is `*`. Non-root presets also carry media claims (`media:read`, plus create/delete from `write` up). A preset expands over one or more `project/env/collection` targets and is otherwise just a claim set — nothing is stored on a key but its claims.
- **Bootstrap:** on first boot with no keys, silo generates a root (`*`) key and prints it to stderr exactly once, boxed under the silo wordmark on a terminal and as flat ASCII when redirected. Locked out? `silo keys create --preset root` on the host works directly against the data dir.
- **Revocation** = deleting the key entry. No expiry and no `last_used_at` in v1 (tracking last-use would turn every request into a storage write, which the fs adapter pays for dearly).
- The UI stores each saved server's key in `localStorage` (`silo_servers`), verifies it with `GET /api/session`, and sends it as a header on every request; no cookies, so no CSRF surface. Any `401` returns the UI to the server manager.

### 8.1 Media: catalog, folders, search, and reference integrity (D23)

Media stays **instance-global** — one library for the whole server, not per
project/env — and `media:read|create|delete` stay unscoped. Folders organize;
they do not authorize.

**Catalog.** Every asset is a `_media` document in `Scope.System`, id = a ULID:

```json
{
  "filename": "hero.png",
  "folder": "/marketing/launch",
  "blob_key": "01J8XQ4Z8K9M2P3R5T7V9X1B3D.png",
  "size": 20481,
  "content_type": "image/png",
  "hash": "e3b0c442...",
  "state": "active",
  "tags": ["hero"]
}
```

`blob_key` is a stored field, so the policy that generates it is one function
and can change without touching the record shape. Folders are metadata: the
key carries no directory component, so moving an asset writes one field and
performs no object-store work — no S3 copy-and-delete, and the archive's flat
`media/` layout (§7.1) is unchanged, so D23 needs no `format_version` bump.

**Folders** follow D20's existence rule in both halves: a folder exists when it
was created explicitly (a `_media_folders` document, id a ULID, `path` in the
data because a `/`-bearing path is not a safe path segment) **or** when some
asset names it. Without the explicit half a folder could not be made before
something was filed into it — the exact gap D20 found with empty projects.

**Search** is the existing Query AST over `_media`: `contains` on `filename`
for `?q=`, `eq` on `folder`, `contains` on `content_type` for `?type=`,
membership on `tags`. No new op, so §5.3's "every op is forever" cost is zero,
and paging plus `total` come from `Storage.list` unchanged.

**References.** Entries name an asset by id — `silo://media/<ulid>` — never by
path, which is what lets a rename leave every entry alone. Extraction is
**structural**, not schema-driven: `MediaRefs.extract` walks the whole `data`
value and collects every string that parses as a reference, regardless of what
the schema says, because §7.2 lets an archive carry `content/<collection>/`
with no schema at all and validation is off by default on import. A
schema-driven walk would find nothing there and a missed reference deletes a
live file. Over-capture (a free-text field holding a literal reference string)
blocks a delete: visible and recoverable. Under-capture orphans: silent. Take
the asymmetry.

Pre-D23 entries hold `/media/<blobKey>`; those are **dual-read** into the token
`blob:<blobKey>` and counted as usages, so a partially backfilled instance
still refuses to delete a referenced file. `silo media reconcile` backfills
catalog records for blobs uploaded before D23, rebuilds usages from entries,
and reports orphan blobs.

**Deletion** is a saga in `Service`, under `writeMu`, because the catalog and a
remote object store cannot share a transaction:

1. Count usages for the asset's id **and** its `blob:` token. Non-zero → `409`.
2. Mark the asset `state: "deleting"` and commit that.
3. Delete the blob.
4. Delete the catalog record.

A crash between 3 and 4 leaves an asset in `deleting`; startup retries the
idempotent blob delete and finishes. `Service` refuses to create a *new*
reference to an asset in `deleting`, so the window cannot be re-entered.
Import does **not** run that check — §7.2 is fidelity-first and validation is
opt-in, so an archive is never rejected for naming an asset it also carries.

**The abort.** A blob delete that fails *permanently* — rotated credentials, a
changed bucket policy — would otherwise strand the asset in `deleting`
forever: unusable, refusing new references, with no operator path out. So
`silo media reconcile` **attempts** the deletion and, if that attempt throws,
returns the asset to `active` and reports it. This is the reverse of the
saga's last step, not a force-delete, and it does not reopen D21.

A blob delete that fails returns **`500 media_delete_stalled`** rather than a
bare internal error: the asset is in a recoverable state, and the body names
it (`media_id`, `blob_key`, the underlying `reason`, and `remedy:
"silo media reconcile"`). An operator driving the API rather than reading the
server's startup log would otherwise have no way to know the asset is staged,
or that a command exists to un-stage it. It is deliberately not a `409` —
`media_in_use` is a refusal the caller fixes by editing entries, this is a
storage failure the caller fixes by fixing the blob store, and a client should
be able to tell the two media-delete outcomes apart by code alone.

Reconcile judges by the *attempt*, never by whether the blob is still present:
a crash between steps 2 and 3 leaves the bytes in place too, and that case must
**complete** rather than reverse. Only an actual failure distinguishes
"interrupted" from "impossible". Startup, by contrast, only ever retries —
one failure is not evidence the operation cannot succeed, and reversing a
deletion is an operator decision, not a boot-time one. Startup therefore counts
failures instead of throwing, because a misconfigured blob store must not stop
the server booting over a deletion someone staged days ago.

There is **no force-delete**. The `409` always reports the total count, and
enumerates only the referrers the calling key may read: media is
instance-global but referrers are scoped, so a key confined to one project must
learn that a file is in use without learning where. The remainder is reported
as a count only.


## 9. Admin UI

React + TypeScript + Vite + RJSF (`@rjsf/core` + `@rjsf/validator-ajv8` for 2020-12), built to `ui/dist`, embedded into the executable through Bun's file imports (D26). The build compiles the UI first; the released binary is self-contained, and serves the UI from whatever directory it is run in.

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
7. **Keys** — list (label, claims, prefix, created), revoke, and a dedicated creation page. The creation page is one guided sentence: a label, a **reach** naming the project and env segments of the key's collection claims independently (one env · a whole project · one env across every project · the whole instance), and a **role** (`read` · `write` · `manage` · `root`). One Advanced disclosure adds what the sentence cannot say — narrowing to named collections, the instance capabilities (media, key management, transfer), and a raw claim editor that takes over from the guided controls when even those are not enough. Choosing a transfer capability composes in the instance-wide collection permissions D21 requires alongside it, rather than naming them in help text. Options the current key cannot delegate are disabled with the reason. The secret is shown once.
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
  Appearance                                     fonts, accent
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

## 10. Configuration & CLI

TOML config + `SILO_*` env overrides + flags (flags > env > file > defaults).

```toml
# silo.toml — every key optional
listen = ":8090"

[storage]
driver = "sqlite"           # "sqlite" | "fs"
path   = "./silo_data"      # dir; sqlite file lives at <path>/silo.db

[blob_storage]
driver = "fs"               # "fs" | "s3"
path   = "./silo_data/media"  # fs driver; defaults to <storage.path>/media

[auth]
disabled = false            # dev-only bypass; if true, disables all auth checks across the app

[schema]
allow_remote_refs = false

[search]
enabled             = true         # false keeps no index; search falls back to a full scan
tokenizer           = "unicode61"  # or "trigram" (substrings; required for CJK)
max_entry_bytes     = 65536        # per-entry cap on indexed text
scan_limit          = 20000        # entries one un-indexed scan may visit before truncating
scan_time_budget_ms = 3000         # ...and how long, whichever comes first

[log]
level       = "info"        # "debug" | "info" | "warn" | "error" | "silent"
format      = "text"        # "text" | "json"
requests    = true          # one line per HTTP request
max_size_mb = 10            # rotate past this size; 0 never rotates
max_files   = 5             # rotated files kept as silo.log.1 … silo.log.<n>
# file = "/var/log/silo.log"  # unset = the console
```

Settings derived from other settings are resolved *after* the whole hierarchy
is applied (`ConfigLoader.resolveDerivedDefaults`), so `--data` relocates the fs
blob path only while nobody has named one: an explicit `[blob_storage] path`,
`SILO_BLOB_PATH` or `--blob-path` wins. Defaults are therefore left unset rather
than pre-filled — a literal default is indistinguishable from a chosen value,
and the two must not be treated alike.

`[log] file` is unset by default for the same reason the fs media path is: the
console is right for a foreground run and for a container, whose supervisor owns
the stream, and a literal default could not be told apart from a path the user
chose. Only `serve --detach` derives one — `<storage.path>/silo.log`, following
the data dir like media does — and hands it to the child as an explicit
`--log-file`, so the derived value never masquerades as a configured one.

Subcommands: `silo init`, `silo serve`, `silo stop`, `silo status`, `silo logs`, `silo export`, `silo import`, `silo keys create|list|revoke`, `silo media reconcile`, `silo search reindex [--check]`, `silo version`. CLI commands operate directly on the data dir — no running server required (this is also the lockout-recovery path). `stop`, `status` and `logs` are the exception in the other direction: they read `silo.run.json` and never open storage at all, for the same reason `init` does not — asking whether a server is running must not create a data directory or take a handle on a database another process owns. `serve --detach` is routed the same way, so the parent leaves the directory entirely to the child it spawns. `init` is the exception that touches neither: it writes a `silo.toml` holding the defaults above, rendered from `ConfigLoader.defaultConfig()` so the scaffold cannot drift from the built-in defaults, with alternatives and the s3 keys commented beside them. Settings with no default — the s3 credentials, the fs media path, and `[log] file` — are written commented out, because a literal value there is indistinguishable from a chosen one and would defeat the derivation above. `keys create` accepts explicit `--claims` or `--preset root|manage|write|read` with optional `--collections`. Presets are defined once in `@silo/shared` (`Claims.presetPermissions`/`presetMedia`) and read by both the CLI and the admin UI's key form, so `--preset manage` and the UI's Manage role grant the same set. First boot creates the data dir, generates `instance_id` (ULID), initializes storage, and — if no keys exist — generates and prints a root key exactly once.

## 11. Milestones

- **M1 — Core + SQLite:** `core` types, Query AST, `Storage` interface, SQLite adapter, schema validation pipeline, HTTP CRUD, key auth (bootstrap root key, claim enforcement, keys endpoints). *Done when: full CRUD with validation over curl, using a generated key.*
- **M2 — Portability:** fs adapter, export/import engine (dir + tarball, merge/replace, dry-run), CLI subcommands, HTTP export/import. *Done when: SQLite→fs→SQLite round-trip is byte-identical (modulo seq) and adapter acceptance test (§7.4) passes.*
- **M3 — Admin UI:** React app — server manager, nav shell, six views (§9) — embedded assets, single-binary build. *Done when: key→schema→form→entry→export works without curl.*
- **M4 — Release:** cross-compilation via `bun build --compile` (linux/darwin × x64/arm64), signed checksums and a Homebrew tap (D26), Dockerfile, README, format_version stamped and documented.

Testing spine: adapter conformance suite (one test file, run against every `Storage` implementation), export/import round-trip properties, validation golden tests.

## 12. Roadmap (designed-for, not built)

1. **Sync** — `Changes(sinceSeq)` on adapters, tombstone records for deletes, `silo sync <remote>` pulling a change feed over HTTP with the §7.2 merge rules. The envelope (`rev`, `seq`, instance_id tiebreak) is already shaped for this.
2. **Cache adapters** — only when something is measurably slow; storage adapters are the pattern template (D7).
3. **Media/blob store (Completed)** — `files/` / `media/` tree; pluggable `BlobStorage` adapter interface supporting local filesystem (`fs`, default) and S3 (`s3`). Extended by D23 with a catalog, folders, search, and reference integrity (§8.1); `BlobStorage` itself stays byte-only.

4. **Auth growth** — per-collection public-read rules (unauthenticated reads for chosen collections), key expiry, `last_used_at` tracking (needs a write-cheap path first), finer-grained per-key permissions. Real user accounts only if keys ever prove insufficient.
5. **Relations** — `x-silo-ref` gains optional integrity enforcement + UI pickers.
6. **Search (Completed)** — D30/§5.5: a `Searcher` port with a portable `ScanSearcher` on every adapter and `SqliteSearcher` (FTS5) where the build has it. Addressing is D29 JSONPath, shared with filters and sort, and the admin UI reads it through collection search, a `⌘K` palette, and a filter builder (§9).
7. **Drafts/publish, webhooks** — after real user demand, not before.
