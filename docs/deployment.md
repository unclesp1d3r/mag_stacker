# Deploying MagStacker (self-hosted)

MagStacker runs as a Docker stack (Next.js app + Postgres) on a machine you
control — a homelab server, a NAS, a small VPS behind your own network.

## First run

1. Copy the env template and fill in the non-secret values (never commit `.env`):

   ```bash
   cp .env.example .env
   # set ADMIN_EMAIL, ADMIN_PASSWORD, and BETTER_AUTH_URL (your reverse-proxy URL)
   ```

2. Create the two Docker secret files. The database password and the Better
   Auth signing secret are **not** set in `.env` — they're Docker secrets,
   plain files under `secrets/` that Compose mounts read-only into the
   containers rather than plaintext environment variables (R16):

   ```bash
   mkdir -p secrets
   openssl rand -hex 24 > secrets/postgres_password.txt
   openssl rand -hex 32 > secrets/better_auth_secret.txt
   ```

   Use `-hex`, not `-base64` — the password is embedded unescaped in a
   connection URL, and base64's `/+=` characters break it there. See
   `secrets/README.md` for rotation notes. `docker compose up` refuses to
   start until both files exist.

3. Build and start the stack. The `migrate` service applies the database
   migrations and — when `ADMIN_EMAIL` / `ADMIN_PASSWORD` are set in `.env` —
   seeds the first operator account, both before the `app` service starts:

   ```bash
   docker compose up --build -d
   ```

   Seeding is idempotent: it creates the admin only on an empty database and
   no-ops afterward, so it is safe to re-run on every `up`. Confirm it ran with:

   ```bash
   docker compose logs migrate    # "Created admin account for <email>."
   ```

   If you start the stack before choosing admin credentials, the seed is
   skipped (the stack still comes up). Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in
   `.env` and re-run `docker compose up -d` to seed — changing `.env` recreates
   the one-shot so it picks up the new values.

   Sign in at `http://<host>:${APP_HOST_PORT}/login`. All other accounts are
   created by an operator from the **Accounts** screen — there is no public
   sign-up.

## Secrets

- The Postgres password and the Better Auth signing secret are Docker
  secrets — files under `secrets/` (see `secrets/README.md`), mounted
  read-only at `/run/secrets/*` inside the containers that need them, never
  a plaintext environment variable (R16). `docker-entrypoint.sh` resolves
  them into `DATABASE_URL`/`BETTER_AUTH_SECRET` at container start; the
  official `postgres` image resolves `POSTGRES_PASSWORD_FILE` itself.
  `.dockerignore`/`.gitignore` exclude both `.env*` and `secrets/*` (except
  `secrets/README.md`) from the build context and git. The image build uses
  throwaway placeholder values that never open a connection.
- Back up Postgres with the standard tooling; a `pg_dump` / `pg_restore`
  round-trip reproduces inventory, ownership, and grant state exactly.

  ```bash
  docker compose exec db pg_dump -U "$POSTGRES_USER" -Fc -d "$POSTGRES_DB" > magstacker.dump
  ```

- The `magstacker-pgdata` and `magstacker-uploads` volumes above hold
  everything sensitive this stack stores — putting them on an encrypted host
  disk is on you, the operator; see
  [`docs/operations/encryption-at-rest.md`](operations/encryption-at-rest.md)
  for the LUKS and encrypted-cloud-volume how-to and a threat-coverage matrix
  covering what disk encryption defends against versus an encrypted in-app
  backup.

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

## Logging

The app logs as **structured JSON to stdout** by default, so `docker logs`
(and anything that scrapes it — a collector, a log driver) gets machine-parsable
lines with a `correlationId` tying together every line from one request, action,
or job. In development the same logger prints human-readable, colorized output
instead. All logging is controlled by env vars — no code edits needed:

| Var | Default | Purpose |
|-----|---------|---------|
| `LOG_LEVEL` | `info` (prod), `debug` (dev) | Minimum level emitted: `fatal\|error\|warn\|info\|debug\|trace`. |
| `LOG_FORMAT` | `json` (prod), `pretty` (dev) | `json` for raw structured output, `pretty` for colorized dev output. Overrides the `NODE_ENV`-derived default. |
| `LOG_FILE` | _unset_ | Path to a rotating log file. **Unset ⇒ stdout only.** Set it to also write JSON to disk — for self-hosters without a log collector. |
| `LOG_FILE_ROTATION` | `10M` | Rotation threshold for `LOG_FILE`: a size like `10M`/`500k`, or `daily`/`hourly`. Retains the 10 most recent files. |

Under the **operator-owned-logs** trust model, stdout and any file you enable
belong to you, the operator — their confidentiality is a deployment concern, not
an app-enforced control. The app redacts secrets (session tokens, passwords,
emails, serial numbers, auth headers) from **structured log fields** by key
name — redaction does **not** scan free-text log messages, so app code must
pass sensitive values as fields, never interpolate them into the message string
(the action-log helper already keeps its message inputs non-sensitive). If you
enable `LOG_FILE`, point it at a path on a mounted volume and treat its
permissions/retention like any other sensitive artifact.

Structured stdout is also the on-ramp to a hosted aggregator (Loki, ELK,
Datadog): point your log driver or collector at the container's stdout — no
app change required.
