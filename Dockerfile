# syntax=docker/dockerfile:1
#
# silo — Bun/TypeScript backend + embedded React UI.
#
#   docker build --pull -t silo .
#   docker run -p 8090:8090 -v silo_data:/data silo
#
# The admin key is printed to the container logs on first run.

ARG BUN_VERSION=1.4.0

# ---- Stage 1: build the admin UI ----
# Each stage copies the manifests of the workspaces it installs and of the
# workspaces those depend on, and no more. Bun skips a member bun.lock lists but
# the context lacks, and aborts only when a present member depends on it: a new
# dependency of the admin's has to be added here, an unrelated workspace does
# not. `--filter @silo/admin` installs only the UI's tree. The admin resolves
# @org-quicko/silo-client through the client's built dist/, so that is built
# first, from the files its build script reads.
FROM oven/bun:${BUN_VERSION}-alpine AS ui
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/admin/package.json ./apps/admin/
COPY packages/shared/package.json ./packages/shared/
COPY packages/silo-client/package.json ./packages/silo-client/
RUN bun install --frozen-lockfile --filter @silo/admin
COPY packages/shared/src/ ./packages/shared/src/
COPY packages/silo-client/src/ ./packages/silo-client/src/
COPY packages/silo-client/tsconfig.json packages/silo-client/tsconfig.build.json ./packages/silo-client/
COPY packages/silo-client/tools/emit-cts-types.ts ./packages/silo-client/tools/
RUN bun run --cwd packages/silo-client build
COPY apps/admin/ ./apps/admin/
RUN bun run --cwd apps/admin build

# ---- Stage 2: runtime ----
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app

# Exactly the server's production dependencies captured in the text lockfile.
# Only the server's own workspaces are copied, so neither the UI's tree (React,
# Vite, CodeMirror — roughly 70 MB) nor the client is installed; the image needs
# nothing from either beyond the UI's prebuilt `dist` copied in below, which
# already bundles the client.
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/src/ ./packages/shared/src/
RUN bun install --frozen-lockfile --production

# Server source and the built UI. `UiAssets` reads ./apps/admin/dist relative to
# the working directory, which is why the layout is preserved rather than
# flattened.
COPY --chown=bun:bun apps/server/src/ ./apps/server/src/
COPY --chown=bun:bun --from=ui /app/apps/admin/dist ./apps/admin/dist

# Keep the database, filesystem-backed media *and the config file* on the
# persistent volume. `silo.toml` is not only read: the settings APIs write it
# (D45/D46/D47), and its default path is `silo.toml` beside the process, which
# here is /app, owned by root while this runs as `bun` and replaced on every
# deploy. A save there fails on permissions, and one that somehow succeeded
# would not survive the next image. SILO_CONFIG is how a container names the
# file, an image having no argv to edit (D50).
ENV NODE_ENV=production \
    SILO_CONFIG=/data/silo.toml \
    SILO_STORAGE_PATH=/data \
    SILO_BLOB_PATH=/data/media \
    SILO_LISTEN=:8090

RUN mkdir -p /data/media && chown -R bun:bun /data
USER bun

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'try { const response = await fetch("http://127.0.0.1:8090/api/health"); process.exit(response.ok ? 0 : 1); } catch { process.exit(1); }'

ENTRYPOINT ["bun", "run", "apps/server/src/main.ts"]
CMD ["serve"]
