# silo-plugin-observability

Operational analytics inside the silo admin: normalized API traffic, error rate,
latency distribution, process memory and CPU, local storage use, and, when the
content is in Postgres, the database.

This is a first-party plugin, and it uses the same contract a third-party
package uses. It is not bundled and it is not enabled for you. The plugin holds
no privilege another package could not ask for: its panel calls its one route,
and that route reads silo's bounded core snapshot through the ordinary
`observability:read` claim.

## Install

```sh
silo add ./plugins/silo-plugin-observability
silo plugin doctor
```

`silo add` copies the directory into `<data dir>/plugins/`, adds a `[[plugins]]`
block to your `silo.toml`, and asks before it grants the one claim the manifest
requires. To do it by hand, place the directory yourself and add:

```toml
[[plugins]]
name       = "silo-plugin-observability"
timeout_ms = 5000
on_error   = "fail"
claims     = ["observability:read", "http:route"]
```

Then open **Settings > Plugins > silo-plugin-observability > Open panel**.

There is no plugin configuration. The dashboard refreshes every ten seconds, and
you can pause it or refresh it yourself. Each chart answers the pointer: hover a
minute in the traffic chart for its requests, errors and average latency, a
latency band for its share, or a status bar for its count. Each panel carries an
`i` in its corner that explains what its numbers mean.

## What the snapshot means

- **API endpoints are grouped by route, with names but never ids.** A
  successful request shows its project, environment and collection, such as
  `/api/projects/acme/environments/prod/collections/posts/:id`. Entry, media
  and key ids stay as `:id`, and a failed request shows the plain route
  pattern, so a made-up name never becomes a row. Query strings, request
  bodies, caller labels, credentials and filesystem paths are never collected.
- **Names appear only for collections the plugin may read.** Approve the
  optional `collections:*/*/*:schema:read` permission to see them, or narrow
  it, for example to `collections:acme/*/*:schema:read`, to name one project
  only. Without it, every endpoint shows its route pattern. For the exact
  path of each request, turn on `[log] requests`: the request log has it,
  with the key that made the call.
- **Error rate is HTTP `4xx` plus `5xx`.** Latency percentiles are bounded
  histogram estimates, and they keep no individual request. An estimate is
  capped at the slowest request actually seen, so a percentile never reads above
  the maximum beside it.
- **Totals live in memory from server start.** A restart resets them. The chart
  keeps sixty one-minute buckets.
- **Memory and cumulative CPU time describe the running silo process.**
- **Directory and filesystem capacity are sampled in the background**, then
  cached. A scan does not follow symlinks and stops after 50,000 entries, and a
  truncated value says so. Media bytes are available for the filesystem blob
  driver only. Capacity at a remote provider is reported as unavailable instead
  of guessed.
- **The two directory figures are disjoint**, so you can add them.
  `[blob_storage] path` defaults to `<storage.path>/media`, so the library
  normally sits inside the data directory, and the data figure excludes it. A
  library pinned outside the data directory is counted in full either way.
- **The Database card appears only with the `postgres` storage driver.** It
  shows the size of silo's own schema, the connection pool (in use, lists
  running and waiting, and since start the lists refused as busy, retries and
  failures), whether this server holds the schema's owner lock, and the TLS
  mode and protocol the connection uses.
- **Internal `ctx.fetch` requests are counted separately**, so plugin traffic is
  visible without disclosing which other plugins are installed.

## Development

```sh
bun x tsc --noEmit -p plugins/silo-plugin-observability/tsconfig.json
bun test plugins/silo-plugin-observability
```

The plugin has no build step and no runtime dependency on silo. `silo:api` is a
virtual module the host injects into its worker. `src/types/silo-api.d.ts` is a
verbatim copy of the host's declarations, and a test in this repository holds the
two byte-identical.

## Licence

AGPL-3.0-or-later, like silo.
