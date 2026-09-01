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
# Every workspace member's manifest has to be present before `bun install` runs:
# Bun aborts with "Workspace not found" if one named in the root manifest is
# missing from the build context. Adding a workspace and not adding it here
# breaks the image build and nothing else. `--filter @silo/admin` then installs
# only the UI's tree, leaving the server's dependencies out.
FROM oven/bun:${BUN_VERSION}-alpine AS ui
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
COPY apps/admin/package.json ./apps/admin/
COPY packages/shared/package.json ./packages/shared/
COPY packages/create-silo-plugin/package.json ./packages/create-silo-plugin/
RUN bun install --frozen-lockfile --filter @silo/admin
COPY packages/shared/src/ ./packages/shared/src/
COPY apps/admin/ ./apps/admin/
RUN bun run --cwd apps/admin build

# ---- Stage 2: runtime ----
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app

# Exactly the production dependencies captured in the text lockfile. The admin
# and scaffolder manifests are copied only to satisfy the workspace declaration;
# neither ships in the image. `--filter '!@silo/admin'` keeps the UI's own tree
# (React, Vite, CodeMirror — roughly 70 MB) out of the runtime image, which
# needs nothing from it but the prebuilt `dist` copied in below.
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
COPY apps/admin/package.json ./apps/admin/
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/src/ ./packages/shared/src/
COPY packages/create-silo-plugin/package.json ./packages/create-silo-plugin/
RUN bun install --frozen-lockfile --production --filter '!@silo/admin'

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
