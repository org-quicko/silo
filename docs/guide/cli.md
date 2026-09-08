# CLI

> Every subcommand, and every flag. The design rationale is in [docs/design/configuration.md](../design/configuration.md).

Every subcommand operates directly on the data directory, with no running server
required. This is also the lockout recovery path. `stop`, `status` and `logs`
are the exception in the other direction: they read the run file and never open
storage at all, so asking whether a server is running cannot create a data
directory or disturb one another process already owns.

An installed binary takes `silo <command>`. The list below is spelled in the
from-source form, `bun run apps/server/src/main.ts <command>`, and the two are
the same program.

```
bun run apps/server/src/main.ts init [flags]                  write a silo.toml of default settings
bun run apps/server/src/main.ts serve [flags]                 start the HTTP server
bun run apps/server/src/main.ts stop [flags]                  stop a server started with --detach
bun run apps/server/src/main.ts status [flags]                report whether a server is running
bun run apps/server/src/main.ts logs [flags]                  show the server log
bun run apps/server/src/main.ts keys create [flags]           mint an API key (secret shown once)
bun run apps/server/src/main.ts keys list                     list keys (label, claims, prefix, created)
bun run apps/server/src/main.ts keys revoke <id>              revoke a key
bun run apps/server/src/main.ts export [flags]                export schemas, entries, and media
bun run apps/server/src/main.ts import [flags] <dir|tarball>  import an export
bun run apps/server/src/main.ts media reconcile               repair the media catalog against stored blobs
bun run apps/server/src/main.ts search reindex [--check]      rebuild the search index, and verify it
bun run apps/server/src/main.ts add <spec> [flags]            install a plugin and list it in silo.toml
bun run apps/server/src/main.ts plugin list                   configured plugins and what they attach to
bun run apps/server/src/main.ts plugin info <name>            one plugin's manifest, claims and config
bun run apps/server/src/main.ts plugin grant <name>           approve what a plugin asked for
bun run apps/server/src/main.ts plugin revoke <name>          withdraw the stored grant
bun run apps/server/src/main.ts plugin doctor                 load every plugin, report failures, exit
bun run apps/server/src/main.ts version                       print the version
```

| Flags | Applies to | Meaning |
|-------|-----------|---------|
| `--config <path>` | all | TOML config file (default `silo.toml` if present); for `init`, the file to write |
| `--force` | `init` | overwrite an existing config file |
| `--data <dir>` | all | data directory (default `./silo_data`) |
| `--blob-path <dir>` | all | media directory for the fs blob driver (default `<data dir>/media`) |
| `--driver <sqlite\|fs>` | all | storage driver |
| `--listen <addr>` | `serve` | listen address (default `:8090`) |
| `--project <id>`, `--env <id>` | `serve` | defaults created on startup (`default`, `prod`) |
| `-d`, `--detach` | `serve` | run in the background and return |
| `--log-file <path>` | `serve` | write the log here (detached runs default to `<data dir>/silo.log`) |
| `--log-level <s>` | `serve` | `debug`, `info`, `warn`, `error`, or `silent` |
| `--timeout <s>` | `stop` | seconds to wait after SIGTERM before killing (default 10) |
| `-n`, `--lines <n>` | `logs` | how many lines to show (default 50) |
| `-f`, `--follow` | `logs` | keep printing as the log grows |
| `--label <s>` | `keys create` | human-readable label |
| `--claims <a,b>` | `keys create` | explicit comma-separated claims |
| `--preset <root\|write\|read>` | `keys create` | claim preset, ignored when `--claims` is given |
| `--collections <a,b>` | `keys create` | collections the preset targets, empty means all |
| `--project <id>`, `--env <id>` | `keys create` | scope the preset targets (default `*`, all) |
| `--dir <path>`, `--out <path>` | `export` | write a directory tree, or a `.tar.gz` |
| `--with-keys` | `export` | include API key hashes |
| `--mode <merge\|replace>` | `import` | conflict strategy (default `merge`) |
| `--validate` | `import` | validate entries against their schema |
| `--dry-run` | `import` | report what would be written, write nothing |
| `--prefer <local\|remote>` | `import` | override merge conflict resolution |
| `--check` | `search reindex` | also report both index integrity checks, exiting non-zero on disagreement |
| `--claims <a,b>` | `plugin grant`, `add` | approve exactly these instead of everything the manifest requests |
| `--integrity <sri>` | `add` | check the downloaded bytes against a `sha512-...` digest |
| `--ref <r>`, `--registry <url>` | `add` | git ref to check out; npm registry to fetch from |
| `-y`, `--yes` | `add` | do not ask before granting (a non-interactive shell without it is a no) |
| `--force` | `add` | replace an already-installed plugin of the same name |
| `--no-register` | `add` | install the files, print the block, leave `silo.toml` alone |

A bare collection name in `--collections` grants the permission in **every**
project and environment (`collections:*/*/<name>:...`). Write
`project/env/collection` to pin it to one scope.

