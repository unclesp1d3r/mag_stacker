# Docker secrets

`docker-compose.yml` reads the database password and the Better Auth signing
secret as [Docker secrets](https://docs.docker.com/compose/how-tos/use-secrets/)
— plain files in this directory, bind-mounted read-only into the containers
that need them at `/run/secrets/*`, rather than plaintext environment
variables (R16). This keeps them out of `docker compose config`, `docker
inspect`, and process-environment dumps on the host.

This directory is gitignored except this file — never commit real secret
values.

## Create the secret files

Before the first `docker compose up`, create both files (run from the repo
root, next to `docker-compose.yml`):

```bash
mkdir -p secrets
openssl rand -hex 24 > secrets/postgres_password.txt
openssl rand -hex 32 > secrets/better_auth_secret.txt
```

Use `-hex`, not `-base64`: `docker-entrypoint.sh` embeds the password
unescaped in `DATABASE_URL` (`postgres://user:PASSWORD@host/db`), and
base64's `/`, `+`, `=` characters are not valid there unescaped — a base64
password with a `/` or `@` in it breaks the connection string.

- `secrets/postgres_password.txt` — the Postgres database password. Consumed
  natively by the official `postgres` image via `POSTGRES_PASSWORD_FILE`
  (only applied the first time the data volume is created — changing this
  file later does not rotate an existing database's password).
- `secrets/better_auth_secret.txt` — the Better Auth session/token signing
  secret. Consumed by `docker-entrypoint.sh`, which resolves
  `BETTER_AUTH_SECRET_FILE` into `BETTER_AUTH_SECRET` before the app or the
  `migrate` bootstrap step starts.

`docker compose up` refuses to start (`secret ... not found`) until both
files exist.

## Local (non-Docker) tooling

`bun test`, `bun run db:migrate`, `bun run dev`, etc. run outside the
containers and build their own `DATABASE_URL` — they don't read these files
automatically. Read the password out when you need it:

```bash
export DATABASE_URL="postgres://magstacker:$(cat secrets/postgres_password.txt)@localhost:${POSTGRES_HOST_PORT:-5544}/magstacker"
```

## Rotating a secret

- **Better Auth secret:** overwrite `secrets/better_auth_secret.txt` and
  restart the `app`/`migrate` services. Rotating it invalidates existing
  sessions (users are signed out).
- **Postgres password:** overwriting the file alone does *not* change the
  running database's password (Postgres only reads it on first init). Change
  the password inside Postgres too (`ALTER USER ... PASSWORD ...`) and keep
  the file in sync, or recreate the data volume for a fresh instance.
