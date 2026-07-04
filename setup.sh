#!/usr/bin/env bash
# MagStacker — one-command setup.
#
# The recommended way to run MagStacker is Docker Compose: this script wraps the
# same `docker compose up --build -d` flow documented in the README. Compose
# brings up Postgres, runs the one-shot `migrate` service (migrations + first
# admin), then starts the app. No local Bun/Node toolchain is required to run it.
#
# Idempotent: safe to re-run. Never overwrites an existing .env, never prints
# secret values, never pushes/commits/destroys anything.
#
# Usage: ./setup.sh
#
# Developing on the code (hot reload, tests) instead of just running it? See
# CONTRIBUTING.md for the Bun + just local dev loop.
set -euo pipefail

# Placeholder values shipped in .env.example — refuse to start with these so a
# deployment never comes up with a default database password, auth secret, or
# admin login.
PLACEHOLDER_POSTGRES_PASSWORD="change-me-in-production"
PLACEHOLDER_AUTH_SECRET="change-me-generate-a-strong-random-secret"
PLACEHOLDER_ADMIN_EMAIL="admin@example.com"
PLACEHOLDER_ADMIN_PASSWORD="change-me-strong-admin-password"

# Read a single KEY=VALUE from .env without sourcing it. Sourcing would execute
# the file as shell, so a stray backtick or `$(...)` in a hand-edited .env could
# run arbitrary commands; this only reads the values we check. Docker Compose
# loads .env itself when it brings the stack up.
env_value() {
  local key="$1" line
  line="$(grep -E "^[[:space:]]*${key}=" .env | tail -n1)" || return 0
  line="${line#*=}"
  line="${line%$'\r'}"
  case "${line}" in
    \"*\") line="${line#\"}"; line="${line%\"}" ;;
    \'*\') line="${line#\'}"; line="${line%\'}" ;;
  esac
  printf '%s' "${line}"
}

echo "=== MagStacker Setup ==="
echo ""

# --- Preflight: Docker is the only requirement ----------------------------

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required. Install: https://docs.docker.com/get-docker/" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: the Docker Compose v2 plugin is required (\`docker compose\`)." >&2
  echo "       Install/upgrade Docker: https://docs.docker.com/compose/install/" >&2
  exit 1
fi

echo "Found docker with the compose plugin."
echo ""

# --- Environment file -----------------------------------------------------

if [[ ! -f .env ]]; then
  if [[ ! -f .env.example ]]; then
    echo "Error: .env.example not found — run this from the project root." >&2
    exit 1
  fi
  cp .env.example .env
  echo "Created .env from .env.example."
  echo ""
  echo "Edit .env and fill in real values before continuing:"
  echo "  - POSTGRES_PASSWORD   (a real database password)"
  echo "  - BETTER_AUTH_SECRET  (generate with: openssl rand -base64 32)"
  echo "  - ADMIN_EMAIL / ADMIN_PASSWORD (your first admin login)"
  echo "  - BETTER_AUTH_URL     (must match the origin you'll open the app at)"
  echo ""
  echo "Postgres only applies POSTGRES_PASSWORD the first time its data volume"
  echo "is created, so set a real password *before* the database starts."
  echo ""
  echo "Re-run ./setup.sh once .env is filled in."
  exit 0
fi

echo ".env found — leaving it untouched."
echo ""

# --- Read .env for presence/placeholder checks (values are never printed) --

postgres_password="$(env_value POSTGRES_PASSWORD)"
auth_secret="$(env_value BETTER_AUTH_SECRET)"
admin_email="$(env_value ADMIN_EMAIL)"
admin_password="$(env_value ADMIN_PASSWORD)"

fail=0

if [[ -z "${postgres_password}" || "${postgres_password}" == "${PLACEHOLDER_POSTGRES_PASSWORD}" ]]; then
  echo "Error: set a real POSTGRES_PASSWORD in .env (still the placeholder)." >&2
  fail=1
fi

if [[ -z "${auth_secret}" || "${auth_secret}" == "${PLACEHOLDER_AUTH_SECRET}" ]]; then
  echo "Error: set a real BETTER_AUTH_SECRET in .env (openssl rand -base64 32)." >&2
  fail=1
fi

# The admin seed is optional — leave both unset to skip it. But if both are set
# (so compose will seed) and either is still the shipped placeholder, refuse:
# otherwise the stack comes up with a known-password admin account.
if [[ -n "${admin_email}" && -n "${admin_password}" ]]; then
  if [[ "${admin_email}" == "${PLACEHOLDER_ADMIN_EMAIL}" || "${admin_password}" == "${PLACEHOLDER_ADMIN_PASSWORD}" ]]; then
    echo "Error: ADMIN_EMAIL/ADMIN_PASSWORD are still the .env.example placeholders." >&2
    echo "       Set real admin credentials, or clear both to skip the first-admin seed." >&2
    fail=1
  fi
fi

if [[ "${fail}" -ne 0 ]]; then
  echo "" >&2
  echo "Fix the values above in .env, then re-run ./setup.sh" >&2
  exit 1
fi

if [[ -z "${admin_email}" || -z "${admin_password}" ]]; then
  echo "Note: ADMIN_EMAIL/ADMIN_PASSWORD not set — the first-admin seed will be"
  echo "      skipped. Set them in .env and re-run to create the admin account."
  echo ""
fi

# --- Bring up the stack via Docker Compose --------------------------------

app_host_port="$(env_value APP_HOST_PORT)"
app_host_port="${app_host_port:-3000}"

echo "Starting the stack (docker compose up --build -d)..."
echo "  db      → Postgres"
echo "  migrate → applies migrations, seeds the first admin (idempotent)"
echo "  app     → MagStacker web app"
echo ""
docker compose up --build -d
echo ""

echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Watch the bootstrap:  docker compose logs -f migrate"
echo "     (look for: 'Created admin account for <email>.')"
echo "  2. Open the app:         http://localhost:${app_host_port}/login"
echo "  3. Sign in as your admin, then add the rest of the accounts."
echo ""
echo "Running on a network? Put MagStacker behind a TLS reverse proxy and set"
echo "BETTER_AUTH_URL to the https:// address — see docs/deployment.md."
