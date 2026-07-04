# mag_stacker justfile
# Run `just` (or `just --list`) to see available recipes.
#
# Single-package Next.js 16 app on Bun. Toolchain: Biome (lint + format
# for TS/TSX/JS/JSON), taplo (TOML), Postgres + Drizzle, Better Auth.
# Tests run under `bun test`; integration/E2E spin up Postgres via
# Testcontainers (Docker required) — there is no docker-compose stack.
#
# All dev tools are pinned in mise.toml and invoked through `mise exec`
# so recipes use the same versions as CI. mise's `_.file` also injects
# `.env` / `.env.local`; recipes that need `DATABASE_URL` (db-migrate,
# seed-admin, tests) rely on it being set there. See AGENTS.md.

set shell := ["bash", "-cu"]
set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]
set dotenv-load := true
set quiet
set ignore-comments

# Use mise to manage all dev tools (bun, taplo, pre-commit, etc.).
# See mise.toml for tool versions.
mise_exec := "mise exec --"

# Default & Help

[private]
default:
    just --list --unsorted

# Setup

alias i := install
alias setup := install

# Install pinned tools (mise) and JS dependencies (bun)
[group('setup')]
install:
    mise install
    {{ mise_exec }} bun install

# Copy the tracked env template to .env.local (won't clobber an existing one)
[group('setup')]
env-setup:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -f .env.local ]]; then
        echo "[env-setup] .env.local already exists — leaving it untouched" >&2
    else
        cp .env.example .env.local
        echo "[env-setup] created .env.local from .env.example — set DATABASE_URL before running the DB recipes" >&2
    fi

# Install the pre-commit git hooks
[group('setup')]
install-hooks:
    {{ mise_exec }} pre-commit install

# Bump pinned tools, JS deps (>=48h old), and pre-commit hook revs
[group('setup')]
update-deps:
    mise upgrade --bump --local
    {{ mise_exec }} bun update --minimum-release-age=172800
    {{ mise_exec }} pre-commit autoupdate

# Remove build artifacts and installed dependencies
[group('setup')]
clean:
    rm -rf node_modules .next coverage playwright-report test-results

# Development

alias r := dev

# Start the Next.js dev server
[group('dev')]
dev:
    {{ mise_exec }} bun run dev

# Print tool + runtime versions and Docker availability
[group('dev')]
info:
    @echo "Bun:    $({{ mise_exec }} bun --version)"
    @echo "Node:   $({{ mise_exec }} node --version 2>/dev/null || echo 'not installed')"
    @echo "Docker: $(docker --version 2>/dev/null || echo 'not installed (required for integration/E2E tests)')"

# Code Quality

alias f := format
alias fmt := format
alias tc := typecheck

# Lint TS/TSX/JS/JSON with Biome
[group('quality')]
lint:
    {{ mise_exec }} bun run lint

# Lint and apply Biome's safe fixes
[group('quality')]
lint-fix:
    {{ mise_exec }} bun x @biomejs/biome check --write

# Format code (Biome) and TOML (taplo)
[group('quality')]
format: format-toml
    {{ mise_exec }} bun run format

# Check formatting without writing (Biome + taplo)
[group('quality')]
format-check: format-toml-check
    {{ mise_exec }} bun x @biomejs/biome format .

# Format all TOML files with taplo
[group('quality')]
format-toml:
    {{ mise_exec }} taplo fmt

# Check TOML formatting without writing
[group('quality')]
format-toml-check:
    {{ mise_exec }} taplo fmt --check

# Run TypeScript type-checking (no emit)
[group('quality')]
typecheck:
    {{ mise_exec }} bun run typecheck

# Run every pre-commit hook against all files
[group('quality')]
pre-commit-run:
    {{ mise_exec }} pre-commit run --all-files

# Testing

alias t := test

# Run the unit/integration suite (integration tests need Docker + DATABASE_URL)
[group('test')]
test:
    {{ mise_exec }} bun run test

# Install Playwright browsers (run once; idempotent)
[group('test')]
test-e2e-install:
    {{ mise_exec }} bun x playwright install --with-deps

# Run the Playwright E2E suite (Docker required — Testcontainers Postgres)
[group('test')]
test-e2e:
    {{ mise_exec }} bun run test:e2e

# Open the Playwright UI runner
[group('test')]
test-e2e-ui:
    {{ mise_exec }} bun run test:e2e:ui

# Build

alias b := build

# Build the production bundle
[group('build')]
build:
    {{ mise_exec }} bun run build

# Start the production server (requires a prior `just build`)
[group('build')]
start:
    {{ mise_exec }} bun run start

# Database

# Generate Drizzle migrations from the schema
[group('db')]
db-generate:
    {{ mise_exec }} bun run db:generate

# Apply pending migrations (needs DATABASE_URL)
[group('db')]
db-migrate:
    {{ mise_exec }} bun run db:migrate

# Seed the admin user (needs ADMIN_EMAIL / ADMIN_PASSWORD + DATABASE_URL)
[group('db')]
seed-admin:
    {{ mise_exec }} bun run seed:admin

# Security

# Generate a CycloneDX SBOM for the dependency tree
[group('security')]
sbom:
    {{ mise_exec }} syft scan dir:. -o cyclonedx-json=sbom.cdx.json

# Final gate before commits
[group('quality')]
ci-check: lint format-check typecheck pre-commit-run test test-e2e
    @echo "[ci-check] all checks passed"
