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

# Run as the unprivileged user shipped in the bun image.
USER bun

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["bun", "run", "start"]
