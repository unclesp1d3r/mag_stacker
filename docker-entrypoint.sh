#!/bin/sh
# Resolves Docker-secrets-style `*_FILE` env vars (POSTGRES_PASSWORD_FILE,
# BETTER_AUTH_SECRET_FILE) into the plain env vars the app/migrate steps read,
# then builds DATABASE_URL from the resolved password if the caller didn't
# already supply one. Runs inside the container only — secret material never
# touches the host process environment or `docker compose config` output,
# only the `/run/secrets/*` files Compose mounts (R16).
#
# Used as the Dockerfile ENTRYPOINT for both the `app` and `migrate` services;
# `docker-compose.yml`'s per-service `command`/default CMD become "$@" below.
set -eu

# Reads a secret file's contents into the named var, trimming one trailing
# newline (some `openssl rand`/`echo`-created secret files carry one).
resolve_secret() {
  var_name="$1"
  file_path="$2"
  if [ -n "${file_path}" ] && [ -f "${file_path}" ]; then
    value="$(cat "${file_path}")"
    export "${var_name}=${value}"
  fi
}

resolve_secret POSTGRES_PASSWORD "${POSTGRES_PASSWORD_FILE:-}"
resolve_secret BETTER_AUTH_SECRET "${BETTER_AUTH_SECRET_FILE:-}"

# DATABASE_URL is not itself a Docker secret (it also carries the non-secret
# host/user/db name), so it's assembled here from the resolved password
# rather than being passed through compose-level `${...}` interpolation --
# that would require the plaintext password in the host's `.env`/shell
# environment, defeating the point of the secret file.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ]; then
  export DATABASE_URL="postgres://${POSTGRES_USER:-magstacker}:${POSTGRES_PASSWORD}@${DB_HOST:-db}:${DB_PORT:-5432}/${POSTGRES_DB:-magstacker}"
fi

exec "$@"
