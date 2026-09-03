# silo-plugin-observability

Operational analytics inside the silo admin: normalized API traffic, error
rate, latency distribution, process memory/CPU totals, and local storage usage.

This is a first-party plugin and uses the same contract as any third-party
package. It is not bundled or enabled automatically. The panel calls the
plugin's one route, and that route reads silo's bounded core snapshot through
the ordinary `observability:read` claim.

## Install

```sh
cp -r silo-plugin-observability <data dir>/plugins/silo-plugin-observability
```

```toml
[[plugins]]
name       = "silo-plugin-observability"
timeout_ms = 5000
on_error   = "fail"
claims     = ["observability:read", "http:route"]
```

Then run `silo plugin doctor` and open **Settings → Plugins →
silo-plugin-observability → Open panel**.

There is no plugin configuration. The dashboard refreshes every ten seconds and
can be paused or refreshed manually.

Every chart answers the pointer: hover a minute on the traffic chart for its
requests, errors and average latency, a latency band for its share, or a status
bar for its count. Each panel carries an `i` in its corner explaining, in a
couple of lines, what the numbers underneath it mean.

## What the snapshot means

- API endpoints are grouped by the registered route pattern. Entry ids,
  project names, query strings, request bodies, caller labels, credentials, and
  filesystem paths are never collected.
- Error rate is HTTP `4xx` plus `5xx`. Latency percentiles are bounded histogram
  estimates; they do not retain individual requests. An estimate is capped at the
  slowest request actually seen, so a percentile never reads above the max beside
  it.
- Totals live in memory from server start. Restarting silo resets them. The chart
  retains sixty one-minute buckets.
- Memory and cumulative CPU time describe the running silo process.
- Data-directory and filesystem capacity are sampled in the background and
  cached. Scans do not follow symlinks and stop after 50,000 entries; a truncated
  value is labelled. Media-directory bytes are available for the filesystem blob
  driver. Remote-provider capacity is reported as unavailable rather than
  guessed.
- **The two directory figures are disjoint.** `[blob_storage] path` defaults to
  `<storage.path>/media`, so the library normally sits inside the data directory;
  the data figure excludes it, and the two can be added. A library pinned outside
  the data directory is counted in full either way.
- Internal `ctx.fetch` requests are counted separately so plugin-generated API
  traffic is visible without disclosing which other plugins are installed.

## Development

```sh
bun x tsc --noEmit -p plugins/silo-plugin-observability/tsconfig.json
bun test plugins/silo-plugin-observability
```

The plugin has no runtime dependency on silo. `silo:api` is the virtual module
the host injects into its worker.
