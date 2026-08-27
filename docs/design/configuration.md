# Configuration and CLI

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

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

# Plugins (D31/§13). An *ordered* array — the order is hook dispatch order.
# Absent by default; `init` writes none. See §13.8 for the full stanza.
# [[plugins]]
# name   = "@acme/silo-plugin-slugs"   # resolved under <storage.path>/plugins/
# claims = ["collections:*/*/*:entries:read"]
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

Subcommands: `silo init`, `silo serve`, `silo stop`, `silo status`, `silo logs`, `silo export`, `silo import`, `silo keys create|list|revoke`, `silo media reconcile`, `silo search reindex [--check]`, `silo plugin list|info|doctor` (D31/§13.8 — read-only, no network), `silo add` (D32/§13.8 — the installer; also spelled `silo plugin add`), `silo version`. CLI commands operate directly on the data dir — no running server required (this is also the lockout-recovery path). `stop`, `status` and `logs` are the exception in the other direction: they read `silo.run.json` and never open storage at all, for the same reason `init` does not — asking whether a server is running must not create a data directory or take a handle on a database another process owns. `serve --detach` is routed the same way, so the parent leaves the directory entirely to the child it spawns. `add` is routed there too and for the same reason: it writes a directory under the data dir and appends to the config file, and opens neither storage nor a plugin — so it is safe against a data dir a live server owns, and what it changes takes effect on that server's next restart, since §13 loads plugins once at startup. `init` is the exception that touches neither: it writes a `silo.toml` holding the defaults above, rendered by `ConfigScaffold` from `ConfigLoader.defaultConfig()` so the scaffold cannot drift from the built-in defaults, with alternatives and the s3 keys commented beside them. That same scaffold is what `silo add` and `POST /api/plugins/install` write when they have a plugin to list and no file to list it in (§13.21) — safe to create unasked precisely because an untouched scaffold is a no-op, since file values sit below flags and env vars. Settings with no default — the s3 credentials, the fs media path, and `[log] file` — are written commented out, because a literal value there is indistinguishable from a chosen one and would defeat the derivation above. `keys create` accepts explicit `--claims` or `--preset root|manage|write|read` with optional `--collections`. Presets are defined once in `@silo/shared` (`Claims.presetPermissions`/`presetMedia`) and read by both the CLI and the admin UI's key form, so `--preset manage` and the UI's Manage role grant the same set. First boot creates the data dir, generates `instance_id` (ULID), initializes storage, and — if no keys exist — generates and prints a root key exactly once.
