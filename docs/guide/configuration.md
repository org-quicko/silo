# Configuration

> Operator reference for `silo.toml`, the `SILO_*` variables, and running silo as a service. The design rationale is in [docs/design/configuration.md](../design/configuration.md).

Configuration layers, highest priority first: **flags**, then `SILO_*`
environment variables, then the TOML file, then the defaults. Every key is
optional.

`silo init` writes the file below. Every setting sits at its default, with the
alternatives and the s3 keys commented beside it. It touches no data directory,
so it is safe to run before anything else.

```toml
# silo.toml
listen          = ":8090"
default_project = "default"   # created on startup if missing
default_env     = "prod"

[http]
idle_timeout = 120      # seconds a connection may stay quiet; 0 disables, 255 is the maximum
max_body_size_mb      = 128   # the largest request body on any route: a media upload, an import
max_json_body_size_mb = 4     # every other route: an entry, a schema, a list of ids

[transfer]
max_archive_size_mb   = 1024  # an import upload, or the export a copy pulls
max_extracted_size_mb = 4096  # what it may unpack to on disk, checked before anything is written

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
# base_url   = "https://cdn.example.com"  # the host every media URL is rooted at
# Unset, media URLs point at the bucket when the provider above is a bucket, and
# at the address each request arrives on when silo serves the bytes itself.
extensions = ["jpg", "jpeg", "png", "gif", "webp", "avif", "ico", "bmp",
              "mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a", "pdf"]
# Uploads are refused unless the filename ends in one of these. ["*"] accepts anything.
# svg is not in the default: it can carry script. Add it where every uploader is trusted.

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
max_files   = 5               # kept as silo.log.1 ... silo.log.5
# file = "/var/log/silo.log"  # unset means the console

# Plugins. An *ordered* array: the order is hook dispatch order. This says
# *which* plugins load. What each may do is a grant in the store, and `claims`
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
| `SILO_HTTP_IDLE_TIMEOUT` | `[http] idle_timeout` |
| `SILO_HTTP_MAX_BODY_SIZE_MB`, `SILO_HTTP_MAX_JSON_BODY_SIZE_MB` | `[http] max_body_size_mb`, `[http] max_json_body_size_mb` |
| `SILO_TRANSFER_MAX_ARCHIVE_SIZE_MB`, `SILO_TRANSFER_MAX_EXTRACTED_SIZE_MB` | `[transfer] max_archive_size_mb`, `[transfer] max_extracted_size_mb` |
| `SILO_READ_THREAD` | `on` or `off`: whether entry lists and searches on SQLite run on a separate storage thread. On by default; off under the test runner. Not in the file |
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
| `SILO_MEDIA_EXTENSIONS` | `[media]`, comma-separated |
| `SILO_VERSION` | the version silo reports. It is not configuration and it is not in the file. The release sets it in the container image, which runs from source and has no other way to know which release it is. A binary ignores it. If you set it, silo tells you a version that it is not |

## Connections that go quiet

`[http] idle_timeout` is the number of seconds a connection can send and
receive nothing before silo closes it. The default is 120. A value above 255 is
reduced to 255, which is the maximum the runtime accepts. `0` switches the check
off. A change takes effect at the next restart.

Raise it if a transfer of a large instance runs longer than this. An export
answers immediately and does not need it. An import and a copy can run for a
long time, and the progress stream in
[transfer.md](transfer.md) is the better answer for those, because it keeps the
connection busy for as long as the work runs.

**If you see a 502 or a 503 from a reverse proxy on a long request, look here
first.** silo closes the connection, the proxy reports what it saw, and silo's
own log shows the request finishing normally. Its error log says `upstream
prematurely closed connection while reading response header`.

You can also set this from the admin, under **Settings > Configuration >
Connections**.

## How much one request may carry

`[http] max_body_size_mb` is the largest request body silo accepts on any
route, in megabytes. The default is 128. It is the ceiling for a media upload,
a media replace, an import archive and a plugin package. A request above it is
refused before silo reads it.

`[http] max_json_body_size_mb` is the ceiling for every other route: an entry,
a schema, a key, a list of ids. The default is 4. A request above it gets a
`413` with the code `payload_too_large`, before the route runs and before the
key is checked.

The runtime holds a request body in memory until the route reads it or answers.
So each open connection can hold up to `max_body_size_mb`. On an instance with
1 GB of memory, set it to the largest upload you expect and no higher. A value
of `0` or less is ignored and the default is used. Both take effect at the next
restart, and both are on the same admin page as the idle timeout.

## How large an archive may be

An archive that arrives over the network is checked twice.

`[transfer] max_archive_size_mb` is the largest archive silo accepts, in
megabytes. The default is 1024. It applies to an upload to `/api/import` and to
the export that `/api/copy` pulls from another instance. An upload is also held
to `[http] max_body_size_mb`, which is normally the lower of the two.

`[transfer] max_extracted_size_mb` is the most an archive may unpack to on
disk. The default is 4096. silo reads each file's size from the archive before
it writes the file, and counts every file as at least 4 KB, so an archive of a
million empty files is refused as well. A small archive built to inflate to
many gigabytes stops here, before it fills the disk that holds your data.

A request past either limit gets a `413` with the code `archive_too_large`.
The message names the setting to raise. Raise both to copy a large instance.
An archive or directory you name on the command line with `silo import` is
not checked. Both take effect at the next restart, and both are on
**Settings > Configuration > Transfers**.

## Media, from the admin

Media storage is also configurable from the admin, under **Settings > Media
Library**, behind the `media:configure` claim. It edits this same file. A save
rewrites the `[blob_storage]` table in place, and leaves the rest of the
document and its comments alone. silo then applies the result to the running
server, with no restart.

Nothing about the layering changes. The page shows what the file says **and**
what is in force, and it names the `SILO_*` variable wherever one beats the
file. Switching provider moves no files: uploads made before the switch stay
where they were.

The same page holds a second section for `[media]`, saved separately. It carries
the **base URL** media links are rooted at, and the **permitted file types**.

The base URL is silo's own public address. Set it and every media URL is that
address with `/media/<id>` on the end. Whatever you give is kept, a path
included, so an instance published under a prefix names the prefix:

| Base URL | A media URL looks like |
|---|---|
| `https://api.example.com` | `https://api.example.com/media/<id>` |
| `https://example.com/silo` | `https://example.com/silo/media/<id>` |

Leave it empty and it depends on who serves the file:

| Provider, no base URL | A media URL looks like |
|---|---|
| Local directory | `<your server's address>/media/<id>` |
| Bucket | `<the bucket's own address>/<blob key>` |
| Bucket, with **Serve files from the bucket** off | `<your server's address>/media/<id>` |

So a bucket with no base URL addresses each file at the bucket, with silo out of
the read path. That is the shape an email needs, because a mail client cannot
authenticate.

Set a base URL and silo serves the files instead, at that address. Use it to
name silo behind a proxy, on a custom domain, or under a path prefix. It cannot
name a CDN in front of the bucket: point such a CDN at the bucket itself, since
it is the bucket's own paths the CDN mirrors.

Turn **Serve files from the bucket** off if your bucket is private. Silo then
streams each file at `/media/<id>`, the same way it does for a local directory,
using the credentials you configured. Nothing else changes and no URL breaks.

Leaving it on is a statement that the bucket already allows anonymous reads. It
does not make it so. Turning off Block Public Access is not enough on its own:
without a policy, S3 answers `AccessDenied` for every file and each media URL
breaks, which looks like silo forming a bad URL but is the bucket refusing a
good one. The policy is:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadForSilo",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
  }]
}
```

Apply that policy and the bucket URLs silo hands out start working. If you would
rather not make a bucket public, turn the toggle off instead.

The allowlist works on the filename extension. silo checks it before it writes
anything, on a rename as well as on an upload, and only the last extension
counts. `["*"]` accepts everything. An instance with no `[media]` table gets the
default list above, so add back any type you need that is not in it, such as
`.docx` or `.zip`. `svg` is not in the default list. An SVG can carry script.
silo sends every file with headers that stop a browser running it, and sends an
SVG as a download rather than a page, so you can add `svg` back when you trust
every uploader. A file's type is read from its extension, never from what the
upload declared.

## Where files go

Media follows the data directory. With the `fs` blob driver, `--data <dir>`
stores uploads in `<dir>/media`, so one instance stays in one place. Naming the
directory yourself takes precedence, through `[blob_storage] path`,
`SILO_BLOB_PATH` or `--blob-path`, and then `--data` leaves it alone.

An invalid default project or environment id fails at startup, rather than
creating a scope no route can address.

## Where the log goes

With no `[log] file`, silo logs to the console. It does that whether or not a
terminal is attached, so `silo serve > out.txt` and a container that expects a
stream both work.

Name a file and silo writes there instead, plus the console when stdout is a
terminal. A foreground server you are watching therefore still shows itself.

`file` is deliberately unset by default. The console is what a supervisor wants,
and a value here is indistinguishable from one you chose. Only `--detach` picks
a path for you, `<data dir>/silo.log`.

Only the running server logs. Every other subcommand writes its output to
stdout, because that output is data you might pipe somewhere. Sending it to a
log file would take the answer away from you.

## Schema references

A schema can reference another schema with standard JSON Schema `$ref`.

- `silo://collections/<name>` points at another collection in the same project
  and environment. It is always allowed, resolved locally, and involves no
  network. The schema builder offers these as **Reference** fields, and an entry
  form renders the referenced collection's fields inline.
- `https://...` remote refs are **rejected by default**. Fetching a schema over
  the network during validation makes a write non-deterministic, it adds an
  availability dependency, and it lets anyone who can edit a schema make your
  server fetch arbitrary URLs. Set `allow_remote_refs = true` to opt in. A
  fetched schema is cached in memory until a schema changes.

Saving a schema bundles its references into `$defs`, and preserves the original
reference URL, so the stored document is self-contained. Deleting a collection
that another schema references fails with `409` unless you force it.

## Running as a service

`silo serve` runs in the foreground and logs to your terminal. That is the right
shape under Docker, systemd, or any other supervisor: let it own the process,
its restarts, and its output stream. On bare metal or in development, `--detach`
runs the same server in the background:

```sh
silo serve --detach --data /srv/silo
```

The log goes to `<data dir>/silo.log` unless `[log] file` names somewhere else.
The child's own stdout and stderr are redirected into it too, so a crash that
never reaches the logger still leaves a trace.

```sh
silo status              # pid, address, driver, log path, uptime, health
silo logs --follow       # tail the log; -n sets how many lines to start with
silo stop                # SIGTERM, then SIGKILL after --timeout (default 10s)
```

`silo serve --detach` does not report success until the child has recorded
itself and answered `/api/health`. If the child dies on the way up, because a
port is taken or the data directory is unreadable, you get a non-zero exit and
the end of its log, rather than a pid that quietly no longer exists.

`silo status` exits non-zero when nothing is running, so a shell can branch on
it. It reports the process and the HTTP endpoint separately: a server that is
alive but not answering is a different problem from one that is gone.

### Running more than one instance

Several silos on one machine are fine. Give each one its own data directory and
its own port:

```sh
silo serve --detach --data /srv/silo-a --listen :8090
silo serve --detach --data /srv/silo-b --listen :8091
```

They share nothing: separate databases, media, keys and `instance_id`. Manage
each one with `--data`, the same flag you started it with.

**What is not supported is two processes over one data directory.** silo refuses
it, and the refusal is not caution:

- The filesystem driver keeps `last_seq` in memory, so two processes hand out
  the same `seq` values. `seq` is the instance-wide write cursor, and duplicates
  in it are not repairable.
- Writes are serialised on a lock inside one process, which is what makes
  `If-Match` optimistic concurrency sound. A second process makes a lost update
  possible again.
- Compiled schema validators are cached per process, so one server would not see
  the other's schema changes.

A running server records itself in `<data dir>/silo.run.json`, and any `serve`
that finds a live one refuses to start. A server that was killed leaves that
record behind, so silo does not trust the file. It decides whether the record
still names a live server by four tests, in this order:

1. The record names this very process. Under Docker the server is always
   process 1, so after a crash the new server finds its own number in the
   record. That record is stale.
2. The record was written before the last reboot (Linux keeps a boot id). That
   record is stale, whatever its process number points at now.
3. The process the record names is gone. Stale.
4. A running server refreshes the record every 30 seconds. A record no server
   has refreshed for 2 minutes is stale, even if its process number now
   belongs to some other program.

Only a record that passes all four is a live server, and only then does a new
`serve` refuse to start. `silo stop` uses the same tests and never signals a
process a stale record points at; it removes the record and says why. A crash
therefore does not lock your data directory out of use. A crash also removes
the record itself where it can: the server catches an uncaught error or a
rejected promise, logs it, removes the record, closes storage and exits with
code 1.

Scaling silo horizontally would mean moving `seq` allocation and write
serialisation into the storage layer. That is a design change, not a
configuration flag.
