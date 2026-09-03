# Configuration and CLI

> Part of silo's design spec. The decisions log (D1–…) that governs it
> lives in [IMPLEMENTATION.md](../../IMPLEMENTATION.md).

## 10. Configuration & CLI

TOML config + `SILO_*` env overrides + flags (flags > env > file > defaults).
*Which* file is chosen the same way: `--config`, then `SILO_CONFIG`, then
`silo.toml` beside the process. The variable is the layer a container has, an
image having no argv to edit (D50), and unlike `--config` it does not make a
missing file an error: a fresh volume has none, and the first save through the
API is what creates it.

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

`default_project` and `default_env` (`--project`/`--env`, `SILO_DEFAULT_*`) name
the scope a **fresh instance** is seeded with, and since D51 that is all they
name. `initDefaults` used to create the scope whenever it was *missing*, which
resurrected it after a delete — and, once the name became mutable, after a
rename: start, rename `default` to `main`, restart, and an empty `default` was
back. Deriving the answer from "does the instance hold any project" has the same
fault one step further out, since it resurrects the default the moment the last
project is deleted. So the fact is recorded durably instead, as
`defaults_initialized` in `meta` (SQLite) and in `manifest.json` (fs), and the
seeding happens exactly once per instance. The ids are still validated at
startup like any other caller-supplied id, so a typo in an env var fails loudly
rather than producing a scope no route can address.

### 10.1 The tables the API writes (D42/D43, D45, D46)

`silo.toml` is the operator's file and stays it, but two of its tables are also
written by the running server. Every editor follows the same rules, and since
D46 they are literally the same code (`TomlTableEdit`): the file is edited as
**text**, so comments outside the edit survive; the result is **parsed before it
is written**, and the write is abandoned unless everything else in the document
reads back identical.

- **`[[plugins]]`** — appended by `POST /api/plugins/install` and `silo add`,
  removed by `DELETE /api/plugins/{name}` (`PluginBlockWriter`, §13.21/§13.22).
  The block it appends carries `claims = []`: only the record half of a grant is
  checked and revocable.
- **`[blob_storage]`** — replaced by `PUT /api/media/storage`
  (`BlobStorageTable`, D45). The whole table goes and is re-rendered, so comments
  *inside* it — including the commented s3 keys `init` writes — do not survive an
  edit made through the API. Nothing above the header or below the next one is
  touched.
- **`[media]`** — replaced by `PUT /api/media/settings` (`MediaTable`, D46):
  `base_url`, `base_url_target` and `extensions`. Its own table rather than more
  keys in `[blob_storage]`, because none of it is a driver setting — an fs
  instance behind a CDN wants a base URL exactly as much as a bucket does — and
  its own route, because a bucket that will not open must not be able to hold up
  a correction to the allowlist.

Neither changes the hierarchy. Flags and `SILO_*` still outrank the file, which
is why both media APIs report what the file says and what is **in force** as two
separate things, and names the variable responsible where it can: an
operator editing a field an env var is beating needs to know the edit will do
nothing. Settings with no default are still written only when they have a value,
so an untouched `[blob_storage] path` stays absent and keeps following the data
dir.

A named config file that does not exist is **created** by either writer, from
`ConfigScaffold` — safe unasked precisely because the scaffold is silo's own
defaults, which file values sitting below flags and env vars makes a no-op. What
is never invented is the *path*: a process handed no config file refuses the
write and says so.

Nor is it assumed to be writable (D50). `ConfigFileAccess` probes it — the file's
own write access, or the nearest directory that exists when the file does not
yet, since the scaffold creates the rest — and every view carries the answer as
`writable` plus a `read_only_reason` the admin prints. The probe is a courtesy
and the write is the guarantee: `ConfigFileAccess.writing` wraps each write, puts
the file back on any failure, and reports a filesystem refusal (`EACCES`,
`EROFS`, `ENOSPC`, …) as a `400` naming the path and the remedy. Anything with no
errno keeps its own error and its `500`, so a bug is still a bug. The failure
this exists for is a container: `silo.toml` defaulting into an image directory
the server's own user cannot write, where the page offered a form and the save
came back `internal error` with the reason only in the log.

### 10.2 The rest of the file, from the API (D47)

`[log]`, `[search]`, `[schema]` and `[auth]` are editable through
`PUT /api/settings/{table}` (§8.4) and a **Settings → Configuration** page. Same
text rules as §10.1 — they go through the same `TomlTableEdit` — but driven by a
**spec** rather than by hand: `ConfigSections` states each field once, and the
reader, the writer, the override report and the admin's form all read it. Doing
otherwise would have meant four more copies of the same mapping, and the way
that goes wrong is a field that saves fine while nothing reports the `SILO_*`
variable beating it.

What changes here that §10.1 did not have to face is that **a write cannot
always be applied**. The hierarchy is unaffected — the file is still third,
below flags and env vars — but a running process is a fourth thing again, and it
is not always willing to move:

| | applies immediately | needs a restart |
|---|---|---|
| `[log]` | `level`, `format`, `requests` | `file`, `max_size_mb`, `max_files` |
| `[search]` | — | all of it |
| `[schema]` | — | `allow_remote_refs` |
| `[auth]` | — | `disabled` |

The split is not arbitrary and is not per table: a level is a threshold read on
every line, while a sink holds a file handle and a rotation policy fixed when it
was opened, and reopening one under a running server is how half a log ends up
in each of two files. So the API keeps the config the process **started on**
separate from the file, updates the first only where something genuinely applied,
and reports the difference as a restart owed. A value written and then echoed
back as "in force" would be worst exactly where it matters most — `[log] file`
is what somebody reads when they are already lost.

Two settings are reported and not (fully) written. **`[storage]`** is read-only:
changing the driver or the data directory does not configure this instance, it
names a different one, and doing that from a browser means watching the content
disappear at the next restart with the file saying you asked for it.
**`[auth] disabled`** may be set to `false` and never to `true`, because an API
able to switch off the authentication protecting it is a lock whose key opens
itself; the tightening direction stays open, since an instance running with auth
off is one where every caller is already root and turning it back on is a repair.

