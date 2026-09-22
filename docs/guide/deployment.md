# Deployment

> Docker, systemd, and what a data volume is for. The design rationale is in [docs/design/architecture.md](../design/architecture.md).

Run silo in the **foreground**, and let Docker, systemd, or another supervisor
own the process. The supervisor then sees the process exit, restarts it, and
collects its output stream. `--detach` is for bare metal and development. Inside
a container it would exit the entrypoint at once and take the container down
with it. Leave `[log] file` unset in both places, so the log reaches
`docker logs` and journald instead of a file inside the container.

## Docker

```sh
docker run -p 8090:8090 -v silo_data:/data labsatquicko/silo
```

The image is on Docker Hub as `labsatquicko/silo`, and on the GitHub registry
as `ghcr.io/org-quicko/silo`. The two are the same image. Each release has a
tag with its version, such as `labsatquicko/silo:1.3.0`, and `:latest` points
at the newest release. Each tag holds an amd64 image and an arm64 image, and
Docker pulls the one your machine needs.

The image is signed. To check the signature before you run it:

```sh
cosign verify docker.io/labsatquicko/silo:1.3.0 \
  --certificate-identity-regexp '^https://github\.com/org-quicko/silo/\.github/workflows/release\.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

It also carries build provenance, which names the workflow that made it:

```sh
gh attestation verify oci://docker.io/labsatquicko/silo:1.3.0 --repo org-quicko/silo
```

An image that you build yourself reports a version that ends in `-dev`. A
released image reports the release version.

To build the image from a source tree instead:

```sh
docker build --pull -t silo .
docker run -p 8090:8090 -v silo_data:/data silo
```

The image runs as the unprivileged `bun` user. Its `/data` volume holds the
SQLite database, and, with the default filesystem media driver, the uploads
under `/data/media`. Supply the mount yourself with `-v`, with Compose, or with
a platform volume. The Dockerfile declares no `VOLUME` on purpose, which keeps
it compatible with platforms such as Railway. A `HEALTHCHECK` on
`GET /api/health` is built in.

**Mount that volume.** Without it, `/data` is part of the container, and each
new deployment starts on an empty one: a new database, no collections, no media,
and a **new root key in the logs**. silo mints a root key exactly when an
instance holds no keys of its own, so a key that changes on every deploy is that
symptom rather than a policy. Mount the volume and the first key carries on.

The image also puts `silo.toml` on that volume, and names it with
`SILO_CONFIG=/data/silo.toml`. The settings APIs write that file. Its default
path is `silo.toml` beside the process, which in the image is `/app`. That
directory is owned by root while the server runs as `bun`, and it is replaced on
every deploy. Point `SILO_CONFIG` somewhere the `bun` user can write, or the
Settings pages report themselves read-only and say why. The file is created on
the first save, so it does not have to exist.

With a host bind mount, make the directory writable by the image's `bun` user
before you start the container.

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

`Type=simple`, the default, is correct here. silo stays in the foreground, so
systemd tracks it directly and needs no pid file. Leave `[log] file` unset and
`journalctl -u silo` has everything.

Do not add `--detach`. The unit would treat the service as dead the moment the
parent returned.
