# syntax=docker/dockerfile:1

# --- Builder: install all deps and produce the production build -------------
FROM oven/bun:1.3.14 AS builder
WORKDIR /app

# Install dependencies against the committed lockfile for reproducible builds.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# `next build` imports the db client, which fails fast without DATABASE_URL.
# The pool connects lazily (never during this dynamic-only build), so a dummy
# value satisfies module load without ever opening a connection. The real
# DATABASE_URL is supplied at runtime by docker-compose.
ENV DATABASE_URL="postgres://build:build@127.0.0.1:5432/build"
ENV BETTER_AUTH_SECRET="build-only-placeholder-secret-not-used-at-runtime"
RUN bun run build

# --- Runner: production-only deps + built app + migration sources -----------
FROM oven/bun:1.3.14-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only (drizzle-orm + pg are runtime deps used by both
# `next start` and the migrate step; drizzle-kit/tailwind/biome stay in the
# build image).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Built output and the files `next start` + the migrate runner need.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/auth.ts ./auth.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

# Create the upload root owned by the unprivileged runtime user BEFORE dropping
# privileges. docker-compose mounts a NAMED volume at /data/uploads (UPLOAD_DIR);
# Docker seeds an empty named volume from the image directory's contents AND
# ownership on first use, so creating it bun-owned here makes the mounted volume
# writable by uid `bun`. Without this the fresh volume mounts root-owned and the
# first upload fails EACCES.
RUN mkdir -p /data/uploads && chown bun:bun /data/uploads

# Resolves Docker-secrets `*_FILE` env vars into the plain env vars the app
# expects (POSTGRES_PASSWORD, BETTER_AUTH_SECRET, DATABASE_URL) before exec'ing
# the real command — see docker-entrypoint.sh (R16). Shared by the `app` and
# `migrate` services in docker-compose.yml.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Run as the unprivileged user shipped in the bun image.
USER bun

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
ENV UPLOAD_DIR=/data/uploads

# Real application health (issue #14): `GET /api/health` answers 200 only when
# `next start` is serving AND Postgres answers a bounded probe, so `docker ps`
# shows what an operator actually cares about, not just that the process is
# alive. Runs scripts/healthcheck.ts with bun because this slim image ships
# neither curl nor wget; the script reads $PORT itself, which is why the exec
# form needs no shell. docker-compose.yml's `app` healthcheck restates this
# command and these timings (Compose overrides the image check when both
# exist) — keep the two in step.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "scripts/healthcheck.ts"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "start"]
