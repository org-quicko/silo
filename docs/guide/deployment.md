# Deployment

> Docker, systemd, and what a data volume is for. The design rationale is in [docs/design/architecture.md](../design/architecture.md).

The Docker image runs as the unprivileged `bun` user. Its `/data` volume holds
both the SQLite database and, with the default filesystem media driver, uploads
under `/data/media`. Supply the mount at runtime with `-v`, Compose, or a
platform volume; the Dockerfile intentionally declares no `VOLUME`, which keeps
it compatible with platforms such as Railway. A `HEALTHCHECK` backed by
`GET /api/health` is built in.

Without a volume at that path, `/data` is part of the container and a new
deployment starts on an empty one: a new database, no collections, no media, and
a **new root key printed in the logs**, since silo mints one exactly when an
instance has no keys of its own. A root key that changes on every deploy is that
symptom and not a policy — mount the volume at the data directory and the first
one carries on.

The image also puts `silo.toml` on that volume, with `SILO_CONFIG=/data/silo.toml`.
The settings APIs write that file, and its default path is `silo.toml` beside the
process, which in the image is `/app` — owned by root while the server runs as
`bun`, and replaced on every deploy. Point `SILO_CONFIG` somewhere else and it
has to be somewhere this user can write, or the Settings pages report themselves
read-only and say why. The file is created on the first save; it need not exist.

Run silo in the **foreground** under Docker, systemd, or any other supervisor —
that is what the image does, and it is what lets the supervisor see the process
exit, restart it, and collect its stream. `--detach` is for bare metal and
development; using it inside a container would exit the entrypoint immediately
and take the container down with it. Leave `[log] file` unset there too, so logs
reach `docker logs` and journald rather than a file inside the container.

With a host bind mount, make the directory writable by the image's `bun` user.
If a volume was created by an older root-running image, migrate its ownership
once:

```sh
docker run --rm --user root --entrypoint chown \
  -v silo_data:/data silo -R bun:bun /data
```

## systemd

Foreground, with systemd owning the process and journald owning the log:

```ini
[Unit]
Description=silo
After=network.target

[Service]
ExecStart=/usr/local/bin/silo serve --data /var/lib/silo --listen :8090
User=silo
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`Type=simple` (the default) is correct here: silo stays in the foreground, so
systemd tracks it directly and needs no pid file. Leave `[log] file` unset and
`journalctl -u silo` has everything. Do not add `--detach` — the unit would
consider the service dead the moment the parent returned.

