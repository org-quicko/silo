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

COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/src/ ./packages/shared/src/
RUN bun install --frozen-lockfile --production

COPY --chown=bun:bun apps/server/src/ ./apps/server/src/
COPY --chown=bun:bun --from=ui /app/apps/admin/dist ./apps/admin/dist

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
