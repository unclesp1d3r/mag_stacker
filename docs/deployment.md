# Deploying MagStacker (self-hosted)

MagStacker runs as a Docker stack (Next.js app + Postgres) on a machine you
control — a homelab server, a NAS, a small VPS behind your own network.

## First run

1. Copy the env template and fill in **real** secrets (never commit `.env`):

   ```bash
   cp .env.example .env
   # set POSTGRES_PASSWORD, BETTER_AUTH_SECRET (openssl rand -base64 32),
   # ADMIN_EMAIL, ADMIN_PASSWORD, and BETTER_AUTH_URL (your reverse-proxy URL)
   ```

2. Build and start the stack. The `migrate` service applies the database
   migrations before the `app` service starts:

   ```bash
   docker compose up --build -d
   ```

3. Seed the first operator account (one time, on an empty database):

   ```bash
   docker compose exec app bun run seed:admin
   ```

   Sign in at `http://<host>:${APP_HOST_PORT}/login`. All other accounts are
   created by an operator from the **Accounts** screen — there is no public
   sign-up.

## Secrets

- `DATABASE_URL` and `BETTER_AUTH_SECRET` are supplied at runtime via `.env` /
  the host environment — never baked into the image. `.dockerignore` excludes
  `.env*` from the build context. The image build uses throwaway placeholder
  values that never open a connection.
- Back up Postgres with the standard tooling; a `pg_dump` / `pg_restore`
  round-trip reproduces inventory, ownership, and grant state exactly.

  ```bash
  docker compose exec db pg_dump -U "$POSTGRES_USER" -Fc -d "$POSTGRES_DB" > magstacker.dump
  ```

## TLS / network exposure (important)

Better Auth uses session **cookies**, and sign-in sends credentials. Do **not**
expose the app's HTTP port directly to your network. Put it behind a
TLS-terminating reverse proxy (Caddy, nginx, Traefik) so cookies and
credentials are never sent in cleartext, and set `BETTER_AUTH_URL` to the
`https://` origin the proxy serves. Forward a single trusted client-IP header
(e.g. `X-Real-IP`) so the auth-endpoint rate limiting keys on the real client.

## Ports

`POSTGRES_HOST_PORT` (default 5544) publishes Postgres for local tooling;
`APP_HOST_PORT` (default 3000) publishes the app. Change `APP_HOST_PORT` if the
default collides with another service on the host.
