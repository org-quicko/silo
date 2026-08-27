# Milestones and roadmap

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 11. Milestones

- **M1 — Core + SQLite:** `core` types, Query AST, `Storage` interface, SQLite adapter, schema validation pipeline, HTTP CRUD, key auth (bootstrap root key, claim enforcement, keys endpoints). *Done when: full CRUD with validation over curl, using a generated key.*
- **M2 — Portability:** fs adapter, export/import engine (dir + tarball, merge/replace, dry-run), CLI subcommands, HTTP export/import. *Done when: SQLite→fs→SQLite round-trip is byte-identical (modulo seq) and adapter acceptance test (§7.4) passes.*
- **M3 — Admin UI:** React app — server manager, nav shell, six views (§9) — embedded assets, single-binary build. *Done when: key→schema→form→entry→export works without curl.*
- **M4 — Release:** cross-compilation via `bun build --compile` (linux/darwin × x64/arm64), signed checksums and a Homebrew tap (D26), Dockerfile, README, format_version stamped and documented.

- **M5 — Plugins (D31/§13):** the registry and static manifest, built-in adapters re-registered under reserved names with no user-visible change, the `silo:api` virtual module, the `Worker` host, the five entry hooks, and the claim-checked context. *Done when: a third-party extension plugin loaded from `<data>/plugins/` rewrites an entry through `entry.beforeValidate`, is refused a claim it did not request, and cannot stall the server when it hangs.* **Done:** 13 tests in `apps/server/test/plugins/` over eight fixture plugins. Everything else plugin-shaped is §12.8 and lands after 1.0.

Testing spine: adapter conformance suite (one test file, run against every `Storage` implementation), export/import round-trip properties, validation golden tests. M5 adds a hostile-plugin suite of its own, because it pins behaviour prose cannot: a hook that spins forever is timed out, faulted and torn down while the server keeps serving, and it is **not** restarted into the same wall on the next write. The companion it was first specified with — a test that a hook fires for `silo import` — was dropped when implementation showed the transfer paths write beneath `Service` and so do not dispatch (see D31); a test asserting otherwise would have pinned a behaviour silo does not have.

## 12. Roadmap (designed-for, not built)

1. **Sync** — `Changes(sinceSeq)` on adapters, tombstone records for deletes, `silo sync <remote>` pulling a change feed over HTTP with the §7.2 merge rules. The envelope (`rev`, `seq`, instance_id tiebreak) is already shaped for this.
2. **Cache adapters** — only when something is measurably slow; storage adapters are the pattern template (D7).
3. **Media/blob store (Completed)** — `files/` / `media/` tree; pluggable `BlobStorage` adapter interface supporting local filesystem (`fs`, default) and S3 (`s3`). Extended by D23 with a catalog, folders, search, and reference integrity (§8.1); `BlobStorage` itself stays byte-only.

4. **Auth growth** — per-collection public-read rules (unauthenticated reads for chosen collections), key expiry, `last_used_at` tracking (needs a write-cheap path first), finer-grained per-key permissions. Real user accounts only if keys ever prove insufficient.
5. **Relations** — `x-silo-ref` gains optional integrity enforcement + UI pickers.
6. **Search (Completed)** — D30/§5.5: a `Searcher` port with a portable `ScanSearcher` on every adapter and `SqliteSearcher` (FTS5) where the build has it. Addressing is D29 JSONPath, shared with filters and sort, and the admin UI reads it through collection search, a `⌘K` palette, and a filter builder (§9).
7. **Drafts/publish, webhooks** — after real user demand, not before. Partly answered by D31/§13: `entry.afterWrite` is where a webhook plugin attaches, but it is in-process and at-most-once, so *durable* delivery still waits on the change feed in §12.1 above — which is the strongest reason to build it.
8. **Plugin growth beyond D31/§13** — all additive, none of it in 1.0. **The installer shipped (D32/§13.8):** `silo add` with integrity pinning and a lockfile, minus the signature policy, which still waits on a trust root worth choosing. What remains: `@silo/conformance` published so third-party `Storage` implementations are testable rather than folklore; further hook points; HTTP interceptors and plugin routes under the reserved `/api/plugins/` prefix; plugin CLI subcommands; named import/export format plugins; and format plugins. **Admin-UI contributions shipped:** declarative settings forms with D40, and custom panels with D41/§13.20 — `contributes.ui` names one inlined HTML file, served as data and rendered by the admin in an origin-less sandboxed iframe whose only channel out reaches that plugin's own routes. The iframe message contract this was waiting on got designed against a consumer that could not work without it rather than in the abstract, which is why it is a contract and not a convention: silo generates the panel-side client.
