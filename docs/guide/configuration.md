# Configuration

> Operator reference for `silo.toml`, the `SILO_*` variables, and running silo as a service. The design rationale is in [docs/design/configuration.md](../design/configuration.md).

Configuration layers, highest priority first: **flags**, then `SILO_*`
environment variables, then the TOML file, then defaults. Every key is optional.

`silo init` writes the file below — every setting at its default, with the
alternatives and the s3 keys commented beside them. It touches no data
directory, so it is safe to run before anything else.

```toml
# silo.toml
listen          = ":8090"
default_project = "default"   # created on startup if missing
default_env     = "prod"

[storage]
driver = "sqlite"       # "sqlite" | "fs"
path   = "./silo_data"  # data dir; the sqlite file lives at <path>/silo.db

[blob_storage]
driver = "fs"                 # "fs" | "s3"
# path = "/srv/silo-media"    # fs driver; unset means <data dir>/media, and --data moves it
# bucket           = "my-silo-media"   # required by the s3 driver
# region           = "ap-south-1"
# endpoint         = "https://..."     # for S3-compatible providers
# access_key_id    = "..."
# secret_access_key = "..."
# force_path_style = false

[media]
# base_url        = "https://cdn.example.com"  # unset means the address each request arrives on
# base_url_target = "server"   # "server": <base>/media/<id>, streamed by silo
                               # "store":  <base>/<blob key>, served by the bucket (must be public)
extensions      = ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "ico",
                   "bmp", "mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a", "pdf"]
# Uploads are refused unless the filename ends in one of these. ["*"] accepts anything.

[auth]
disabled = false        # dev only: if true, every request is treated as root

[schema]
allow_remote_refs = false  # opt in to fetching http(s) $refs during validation

[search]
enabled             = true          # false keeps no index; search falls back to a full scan
tokenizer           = "unicode61"   # "unicode61" (words) | "trigram" (substrings; required for CJK)
max_entry_bytes     = 65536         # per-entry cap on indexed text
scan_limit          = 20000         # entries one un-indexed scan may visit before truncating
scan_time_budget_ms = 3000          # ...and how long, whichever comes first
# Changing the tokenizer rebuilds the index on the next start.

[log]
level       = "info"          # "debug" | "info" | "warn" | "error" | "silent"
format      = "text"          # "text" (human) | "json" (one object per line)
requests    = true            # a line per HTTP request
max_size_mb = 10              # rotate past this size; 0 never rotates
max_files   = 5               # kept as silo.log.1 … silo.log.5
# file = "/var/log/silo.log"  # unset means the console

# Plugins. An *ordered* array — the order is hook dispatch order. This says
# *which* plugins load; what each may do is a grant in the store, and `claims`
# here is a second, declarative way to say it. Absent by default; `init` writes
# none. See plugins.md.
# [[plugins]]
# name   = "silo-plugin-slug"           # a directory under <data dir>/plugins/
# claims = ["collections:*/*/*:entries:read"]
```

| Environment variable | Overrides |
|----------------------|-----------|
| `SILO_CONFIG` | which file this table is read from and written to, below `--config` |
| `SILO_LISTEN` | `listen` |
| `SILO_DEFAULT_PROJECT`, `SILO_DEFAULT_ENV` | `default_project`, `default_env` |
| `SILO_STORAGE_DRIVER`, `SILO_STORAGE_PATH` | `[storage]` |
| `SILO_BLOB_DRIVER`, `SILO_BLOB_PATH` | `[blob_storage]` |
| `SILO_BLOB_S3_BUCKET`, `SILO_BLOB_S3_REGION`, `SILO_BLOB_S3_ENDPOINT` | `[blob_storage]` |
| `SILO_BLOB_S3_ACCESS_KEY_ID`, `SILO_BLOB_S3_SECRET_ACCESS_KEY` | `[blob_storage]` |
| `SILO_BLOB_S3_FORCE_PATH_STYLE` | `[blob_storage]` |
| `SILO_AUTH_DISABLED` | `[auth] disabled` |
| `SILO_SCHEMA_ALLOW_REMOTE_REFS` | `[schema] allow_remote_refs` |
| `SILO_SEARCH_ENABLED`, `SILO_SEARCH_TOKENIZER` | `[search]` |
| `SILO_LOG_LEVEL`, `SILO_LOG_FILE`, `SILO_LOG_FORMAT` | `[log]` |
| `SILO_LOG_REQUESTS`, `SILO_LOG_MAX_SIZE_MB`, `SILO_LOG_MAX_FILES` | `[log]` |
| `SILO_MEDIA_BASE_URL`, `SILO_MEDIA_BASE_URL_TARGET` | `[media]` |
| `SILO_MEDIA_EXTENSIONS` | `[media]` (comma-separated) |

Media storage is also configurable **from the admin**, under Settings → Media
Library, behind the `media:configure` claim (D45). It edits this file: a save
rewrites the `[blob_storage]` table in place, leaving the rest of the document
and its comments alone, then applies the result to the running server without a
restart. Nothing about the hierarchy changes, so the page shows what the file
says *and* what is in force, and names the `SILO_*` variable wherever one is
beating the file. Switching provider moves no files: uploads made before the
switch stay where they were.

The same page holds a second card for `[media]` (D46), saved separately: the
**base URL** media links are rooted at, whether that name points at silo or at
the bucket, and the **permitted file types**. Leave the base URL empty and every
media URL is rooted at the address the request arrived on, which is what you
want behind no proxy. Set it to a CDN and pick `store`, and media fields resolve
to `<base>/<blob key>` with silo out of the read path entirely — the shape an
email needs, since a mail client cannot authenticate. That requires a publicly
readable bucket.

The allowlist is on the filename extension, checked before anything is written
and on rename as well as upload, and only the last extension counts. `["*"]`
accepts everything. **Upgrading an instance with no `[media]` table applies the
default list**, so file types you were accepting before — `.docx`, `.zip` — need
adding back. `svg` ships in the default: it can carry script and is served
inline from silo's own origin, so drop it where uploaders are untrusted.

Media follows the data directory: with the `fs` blob driver, `--data <dir>`
stores uploads in `<dir>/media`, so one instance stays in one place. Naming the
directory yourself — `[blob_storage] path`, `SILO_BLOB_PATH` or `--blob-path` —
takes precedence and `--data` leaves it alone.

Invalid default project or environment ids fail at startup rather than creating
a scope that no route can address.

**Where the log goes.** With no `[log] file`, silo logs to the console — always,
whether or not a terminal is attached, so `silo serve > out.txt` and a container
that expects a stream both work. Name a file and silo writes there instead, plus
the console when stdout is a terminal, so a foreground server you are watching
still shows itself. `file` is deliberately left unset by default: the console is
what a supervisor wants, and a value here is indistinguishable from one you
chose. Only `--detach` picks a path for you, `<data dir>/silo.log`.

Only the running server logs. Every other subcommand writes its output to
stdout, because that output is data you might pipe somewhere — sending it to a
log file would take the answer away from you.

## Schema references

A schema can reference other schemas with standard JSON Schema `$ref`:

- `silo://collections/<name>` points at another collection in the same project
  and environment. Always allowed, resolved locally, no network involved. The
  schema builder offers these as **Reference** fields, and entry forms render
  the referenced collection's fields inline.
- `https://...` remote refs are **rejected by default**. Fetching schemas over
  the network during validation makes writes non-deterministic, adds an
  availability dependency, and lets anyone who can edit a schema make your
  server fetch arbitrary URLs. Set `allow_remote_refs = true` to opt in; fetched
  schemas are cached in memory until a schema changes.

Saving a schema bundles its references into `$defs` while preserving the
original reference URL, so the stored document is self-contained. Deleting a
collection that another schema references fails with `409` unless forced.

## Running as a service

`silo serve` runs in the foreground and logs to your terminal. That is the right
shape under Docker, systemd, or any other supervisor — let it own the process,
its restarts, and its output stream. On bare metal or in development, `--detach`
runs the same server in the background:

```sh
silo serve --detach --data /srv/silo
```

The log goes to `<data dir>/silo.log` unless `[log] file` names somewhere else,
and the child's own stdout and stderr are redirected into it too — so a crash
that never reaches the logger still leaves a trace.

```sh
silo status              # pid, address, driver, log path, uptime, health
silo logs --follow       # tail the log; -n sets how many lines to start with
silo stop                # SIGTERM, then SIGKILL after --timeout (default 10s)
```

`silo serve --detach` does not report success until the child has recorded
itself and answered `/api/health`. If it dies on the way up — a port already
taken, an unreadable data directory — you get a non-zero exit and the end of its
log, rather than a pid that quietly no longer exists.

`silo status` exits non-zero when nothing is running, so a shell can branch on
it. It reports the process and the HTTP endpoint separately: a server that is
alive but not answering is a different problem from one that is gone.

### Running more than one instance

Several silos on one machine are fine. Give each its own data directory and its
own port:

```sh
silo serve --detach --data /srv/silo-a --listen :8090
silo serve --detach --data /srv/silo-b --listen :8091
```

They share nothing — separate databases, media, keys, and `instance_id`. Manage
each with `--data`, the same flag you started it with.

**What is not supported is two processes over one data directory.** silo refuses
it, and the refusal is not caution:

- The filesystem driver keeps `last_seq` in memory, so two processes hand out
  the same `seq` values. `seq` is the instance-wide write cursor that
  replication will be built on; duplicates in it are not repairable.
- Writes are serialised on a lock inside one process, which is what makes
  `If-Match` optimistic concurrency sound. A second process makes lost updates
  possible again.
- Compiled schema validators are cached per process, so one server would not see
  the other's schema changes.

A running server records itself in `<data dir>/silo.run.json`, and any `serve`
that finds a live one refuses to start. A server that was killed leaves that
record behind; silo checks whether the process still exists rather than trusting
the file, so a crash never locks your data directory out of use.

Scaling silo horizontally would mean moving `seq` allocation and write
serialisation into the storage layer — a real design change, not a
configuration flag. It is not on the roadmap.

