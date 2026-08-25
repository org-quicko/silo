/**
 * The `silo help` text.
 *
 * Its own file because it is a hundred lines of prose that would otherwise sit
 * in the middle of the argument parser, and because it is documentation: it is
 * edited when a flag changes, not when the routing does.
 */
export class UsageText {
  static print(): void {
    console.log(`silo, minimal portable headless CMS

Usage:
  silo init [flags]                      write a silo.toml of default settings
  silo serve [flags]                     start the server
  silo stop [flags]                      stop a server started with --detach
  silo status [flags]                    report whether a server is running
  silo logs [flags]                      show the server log
  silo keys create [flags]               mint an API key
  silo keys list [flags]                 list keys
  silo keys revoke [flags] <id>          revoke a key
  silo export [flags]                    export schemas and entries
  silo import [flags] <dir|tarball>      import schemas and entries
  silo media reconcile [flags]           repair the media catalog against stored blobs
  silo search reindex [--check]          rebuild the search index (--check validates it too)
  silo add [flags] <name|path|url>       install a plugin and list it in silo.toml
  silo plugin list                       configured plugins and what they attach to
  silo plugin info <name>                a plugin's manifest, claims and config schema
  silo plugin doctor                     load every plugin, report failures, exit
  silo version
  silo help

Common flags:
  --config path     TOML config file (default: silo.toml if present)
  --data dir        data directory (default ./silo_data)
  --driver name     storage driver: sqlite | fs (default sqlite)
  --blob-path dir   media directory for the fs blob driver (default <data>/media)

init:
  --config path   file to write (default silo.toml)
  --force         overwrite an existing file

serve:
  --listen addr    listen address (default :8090)
  --project id     default project created on startup (default "default")
  --env id         default environment created on startup (default "prod")
  -d, --detach     run in the background and return; logs go to a file
  --log-file path  write the log here (detached runs default to <data>/silo.log)
  --log-level s    debug | info | warn | error | silent (default info)

stop:
  --timeout s      seconds to wait after SIGTERM before killing (default 10)

logs:
  -n, --lines n    how many lines to show (default 50)
  -f, --follow     keep printing as the file grows

keys create:
  --label s            human-readable label
  --claims a,b         comma-separated claims
  --preset s           root | manage | write | read (default read; ignored with --claims)
  --collections a,b    collections for read/write/manage presets (empty = all)
  --project id         project the preset's claims target (default * = all)
  --env id             environment the preset's claims target (default * = all)

export:
  --dir path           export to directory layout
  --out path           export to .tar.gz tarball
  --with-keys          include API keys in export

import:
  --mode s             merge | replace (default merge)
  --validate           strictly validate entries against schema (default false)
  --dry-run            verify import structure without writing (default false)
  --prefer s           local | remote (override conflict resolution)

add: installs into <data>/plugins/ and appends a [[plugins]] block to the config.
  <spec> is a package name ("silo-plugin-slug", "@acme/x@^1"), a directory or
  .tgz path, a git URL, or an https tarball URL.
  --claims a,b     grant these instead of what the manifest requests
  -y, --yes        do not ask before granting the claims it requests
  --force          replace an already-installed plugin of the same name
  --ref name       git branch or tag
  --integrity sri  check the bytes against "sha512-..." before unpacking. Applies
                   to a .tgz path, an npm spec (on top of the registry's own
                   digest, so both must agree) and an https URL; a directory or
                   git source has nothing to hash and refuses the flag
  --registry url   npm registry (default https://registry.npmjs.org)
  --timeout-ms n   per-dispatch budget written into the block (default 5000)
  --on-error s     fail | skip, written into the block (default fail)
  --no-register    install the files, print the block, leave silo.toml alone

Installing a plugin runs none of its code and no lifecycle script. What it
downloads is checked against the registry's own digest; a plain URL is checked
only against --integrity, and a git checkout is pinned by commit. What was
installed, and what it was verified as, is recorded in
<data>/plugins/silo-plugins.lock.json — a record, not a resolver: serve still
loads exactly what silo.toml names. Plugins are read at startup, so a running
server picks up an added plugin on its next restart.

Environment overrides: SILO_LISTEN, SILO_DEFAULT_PROJECT, SILO_DEFAULT_ENV,
SILO_STORAGE_DRIVER, SILO_STORAGE_PATH, SILO_BLOB_DRIVER, SILO_BLOB_PATH,
SILO_BLOB_S3_*, SILO_AUTH_DISABLED, SILO_SCHEMA_ALLOW_REMOTE_REFS,
SILO_LOG_LEVEL, SILO_LOG_FILE, SILO_LOG_FORMAT, SILO_LOG_REQUESTS,
SILO_LOG_MAX_SIZE_MB, SILO_LOG_MAX_FILES.

One server per data directory: serve refuses to start over a live one, because
two processes would allocate the same seq values and defeat the in-process
write lock. Run several instances by giving each its own --data and --listen.
Under Docker or systemd, run serve in the foreground and let the supervisor own
the process; --detach is for bare metal and development.

Project and env ids use the same grammar as collection names
(lowercase letter first, then [a-z0-9_-], max 64 chars); serve refuses to
start on an invalid default rather than creating a scope no route can reach.
Subcommands operate directly on the data dir — no running server needed.
`);
  }
}
