# Architecture

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

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
      blob/                    # FsBlobStorage, S3BlobStorage (selected by ProviderRegistry, D31)
      http/                    # HttpSiloClient (direct-copy source client)
    plugins/                   # D31: PluginManifest, PluginRegistry, PluginLoader,
                               #   PluginHost port + WorkerHost,
                               #   PluginContext, HookBus, PluginClaims, SiloApi
      install/                 # D32: PluginInstaller, SourceParser, the five
                               #   fetchers, PackageExtractor, Integrity,
                               #   NpmRegistry, PluginLock. Depends on the four
                               #   above; nothing in the load path depends on it
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

The export/import engine lives in `apps/server/src/core/transfer/` and speaks only through the `Storage` interface — that is what makes cross-adapter migration (export from SQLite, import into fs) automatic.
