# CLI

> Every subcommand, and every flag. The design rationale is in [docs/design/configuration.md](../design/configuration.md).

Every subcommand works directly on the data directory. No server has to be
running. This is also the way back from a lockout.

`stop`, `status` and `logs` are the exception, in the other direction. They read
the run file and never open storage. Asking whether a server is running
therefore cannot create a data directory, and it cannot disturb one that
another process already owns.

From source, replace `silo` with `bun run apps/server/src/main.ts`. The two are
the same program.

```
silo init [flags]                  write a silo.toml of default settings
silo serve [flags]                 start the HTTP server
silo stop [flags]                  stop a server started with --detach
silo status [flags]                report whether a server is running
silo logs [flags]                  show the server log
silo keys create [flags]           mint an API key (the secret is shown once)
silo keys list                     list keys (label, claims, prefix, created)
silo keys revoke <id>              revoke a key
silo export [flags]                export schemas, entries, and media
silo import [flags] <dir|tarball>  import an export
silo media reconcile               repair the media catalog against stored blobs
silo search reindex [--check]      rebuild the search index, and verify it
silo add <spec> [flags]            install a plugin and list it in silo.toml
silo plugin list                   configured plugins, and what they attach to
silo plugin info <name>            one plugin's manifest, claims and config
silo plugin grant <name>           approve what a plugin asked for
silo plugin revoke <name>          withdraw the stored grant
silo plugin doctor                 load every plugin, report failures, exit
silo version                       print the version
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
| `--preset <root\|manage\|write\|read>` | `keys create` | claim preset, default `read`, ignored when `--claims` is given |
| `--collections <a,b>` | `keys create` | collections the `read`, `write` and `manage` presets target, empty means all |
| `--project <id>`, `--env <id>` | `keys create` | scope the preset targets (default `*`, all) |
| `--dir <path>`, `--out <path>` | `export` | write a directory tree, or a `.tar.gz` |
| `--with-keys` | `export` | include API key hashes |
| `--mode <merge\|replace>` | `import` | conflict strategy (default `merge`) |
| `--validate` | `import` | validate entries against their schema |
| `--dry-run` | `import` | report what would be written, write nothing |
| `--prefer <local\|remote>` | `import` | override merge conflict resolution |
| `--check` | `search reindex` | also report both index integrity checks, and exit non-zero on disagreement |
| `--claims <a,b>` | `plugin grant`, `add` | approve exactly these instead of everything the manifest requests |
| `--integrity <sri>` | `add` | check the downloaded bytes against a `sha512-...` digest |
| `--ref <r>`, `--registry <url>` | `add` | git ref to check out; npm registry to fetch from |
| `-y`, `--yes` | `add` | do not ask before granting. A non-interactive shell without this is a no |
| `--force` | `add` | replace an already-installed plugin of the same name |
| `--no-register` | `add` | install the files, print the block, and leave `silo.toml` alone |

A bare collection name in `--collections` grants the permission in **every**
project and environment, as `collections:*/*/<name>:...`. Write
`project/env/collection` to pin it to one scope.
