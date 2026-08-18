# syntax=docker/dockerfile:1
#
# silo — Bun/TypeScript backend + embedded React UI.
#
#   docker build --pull -t silo .
#   docker run -p 8090:8090 -v silo_data:/data silo
#
# The admin key is printed to the container logs on first run.

ARG BUN_VERSION=1.3.14

# ---- Stage 1: build the admin UI ----
FROM oven/bun:${BUN_VERSION}-alpine AS ui
WORKDIR /ui
COPY shared/package.json /shared/package.json
COPY shared/src/ /shared/src/
COPY ui/package.json ui/bun.lock ./
RUN bun install --frozen-lockfile
COPY ui/ ./
RUN bun run build

# ---- Stage 2: runtime ----
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app

# Install exactly the production dependencies captured in the text lockfile.
COPY shared/package.json ./shared/package.json
COPY shared/src/ ./shared/src/
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source and built UI
COPY --chown=bun:bun server/ ./server/
COPY --chown=bun:bun --from=ui /ui/dist ./ui/dist

# Keep both the database and filesystem-backed media on the persistent volume.
ENV NODE_ENV=production \
    SILO_STORAGE_PATH=/data \
    SILO_BLOB_PATH=/data/media \
    SILO_LISTEN=:8090

RUN mkdir -p /data/media && chown -R bun:bun /data
USER bun

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'try { const response = await fetch("http://127.0.0.1:8090/api/health"); process.exit(response.ok ? 0 : 1); } catch { process.exit(1); }'

ENTRYPOINT ["bun", "run", "server/main.ts"]
CMD ["serve"]
