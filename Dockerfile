# syntax=docker/dockerfile:1

# --- Builder: install all deps and produce the production build -------------
FROM oven/bun:1.3.14 AS builder
WORKDIR /app

# Install dependencies against the committed lockfile for reproducible builds.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
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
COPY --from=builder /app/src ./src

# Run as the unprivileged user shipped in the bun image.
USER bun

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["bun", "run", "start"]
