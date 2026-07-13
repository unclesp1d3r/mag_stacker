# Contributing to MagStacker

Thanks for your interest in improving MagStacker. This guide covers the practical steps for getting a change from idea to merged PR.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) — local Postgres, plus Testcontainers for integration/E2E tests.
- [mise](https://mise.jdx.dev/) — pins and installs the rest of the toolchain (Bun, just, pre-commit, shellcheck, …) at the exact versions CI uses, and loads your `.env` / `.env.local` into the shell.

`mise` is how the toolchain stays reproducible, so install it first — it provides [Bun](https://bun.sh) (the runtime and package manager — not npm/yarn/pnpm) and [just](https://github.com/casey/just) (the task runner that wraps every common command). If you'd rather manage those two yourself, install Bun and just directly, but you're then on your own for version pinning.

## Getting started

```bash
git clone https://github.com/unclesp1d3r/mag_stacker.git
cd mag_stacker
```

**To run a full instance** (the recommended setup — Docker Compose, no local toolchain needed), use `./setup.sh`. It copies `.env.example` to `.env` on first run, then `docker compose up --build -d` brings up Postgres, applies migrations, seeds your first admin, and starts the app:

```bash
./setup.sh
# fill in .env when prompted, then re-run:
./setup.sh
```

**To work on the code** (hot reload + tests) you run the app on the host with Postgres in a container. Everything goes through `mise` and `just`:

```bash
mise install            # install the pinned toolchain (Bun, just, pre-commit, …)
just install            # mise install + bun install
just env-setup          # create .env.local from .env.example
just install-hooks      # install the pre-commit hooks (once)
```

The database password and Better Auth signing secret are Docker secrets (R16), not `.env` values — create them once, owner-only and only if they don't already exist (see [`secrets/README.md`](secrets/README.md)). Re-running the commands below is safe: an existing Postgres data volume keeps the password it was created with, so overwriting the file would just lock you out.

```bash
mkdir -p secrets
[ -f secrets/postgres_password.txt ] || (umask 077 && openssl rand -hex 24 > secrets/postgres_password.txt)
[ -f secrets/better_auth_secret.txt ] || (umask 077 && openssl rand -hex 32 > secrets/better_auth_secret.txt)
```

`mise` loads `DATABASE_URL` and `BETTER_AUTH_SECRET` from `.env.local` like any other variable, but it only parses `KEY=VALUE` lines — it doesn't run a shell, so a literal `$(cat ...)` typed into the file is never expanded and `DATABASE_URL` would end up containing that unevaluated text. Let your shell do the substitution once, when you write the file:

```bash
echo "DATABASE_URL=postgres://magstacker:$(cat secrets/postgres_password.txt)@localhost:5544/magstacker" >> .env.local
echo "BETTER_AUTH_SECRET=$(cat secrets/better_auth_secret.txt)" >> .env.local
```

If you want a seeded admin, also fill in `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env.local`. Now bring up the database and start the app:

```bash
docker compose up -d db   # local Postgres on host port 5544
just db-migrate           # apply migrations
just seed-admin           # optional: create your first admin
just dev                  # http://localhost:3000
```

> `mise` caches env (`env_cache`) and loads both `.env` and `.env.local`. After you edit either file, run `mise cache clear` — a stale value can otherwise shadow both your tooling and `docker compose`.

The `just` recipes run under `mise exec`, so you don't need to activate a shell or prefix commands with `mise exec` yourself. See the "For developers" section in [README.md](README.md) and [AGENTS.md](AGENTS.md) for stack details and project conventions.

## Development loop

```bash
just dev              # start the Next.js dev server (http://localhost:3000)
just lint             # biome check
just format           # biome format --write (+ taplo for TOML)
just typecheck        # tsc --noEmit
just test             # unit + integration (bun test)
just test-e2e         # Playwright E2E (Docker required — Testcontainers Postgres)
```

Run `just --list` for the full recipe list.

The first time you run E2E tests, install the Playwright browser once:

```bash
just test-e2e-install
```

## The pre-commit gate

This repo has one rule that overrides convenience: **`just ci-check` must pass before every commit.** It runs lint, format-check, typecheck, pre-commit hooks, the unit/integration suite, and the E2E suite — the same checks CI runs.

```bash
just ci-check
```

Do not commit while it's red. Do not use `git commit --no-verify` or skip hooks to get around it. If a check fails, fix the underlying issue — don't adjust the test to make it pass unless the test itself is wrong.

## Code style

- **Biome**, not ESLint/Prettier, formats and lints TypeScript/TSX/JS/JSON. Run `just format` before committing; `just lint` catches what formatting won't.
- Prefer immutable updates over in-place mutation.
- Keep files focused and small — split large modules rather than growing one file indefinitely.
- Validate all external/user input at system boundaries; fail fast with clear errors.
- Follow the conventions in [AGENTS.md](AGENTS.md) — it documents the active stack, auth model, and DB access patterns in more detail than this file does.

## Testing expectations

- Unit tests run under `bun test` (`src/`).
- Integration and E2E tests **must** use [Testcontainers](https://testcontainers.com/) for backing services (Postgres) — no shared/dev database in tests, and no hand-rolled container management. Docker must be running.
- Target UI elements via ARIA roles, accessible names, or visible text. **Do not add `data-testid` attributes** — see `e2e/README.md` for the established pattern.
- New behavior needs test coverage; bug fixes should include a regression test where practical.

## Commit conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/) style messages: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, etc.

- Sign off every commit for DCO compliance:

  ```bash
  git commit -s
  ```

- Commits must be GPG-signed. Do not use `--no-gpg-sign`.

## Opening a pull request

1. Fork the repo and create a feature branch off `main`.
2. Make your change, keeping it focused and reasonably small.
3. Run `just ci-check` locally and make sure it's green.
4. Open a PR against `main` describing what changed and why. Link any related issue.
5. Respond to review feedback — CI must be green before merge.

## Releases

Maintainers cut releases by pushing a semver `vX.Y.Z` tag, which builds and publishes the container image to GHCR. The full process — versioning, tagging, what gets published, verification, and rollback — is in [RELEASE.md](RELEASE.md).

## Reporting issues

Use the GitHub issue templates (bug report or feature request) so we get the context we need up front — especially your deployment method (Docker image tag vs. build-from-source), Docker version, and browser, for bug reports.

## Security issues

Please do not open a public issue for a security vulnerability. Use [GitHub Security Advisories](https://github.com/unclesp1d3r/mag_stacker/security/advisories/new) for the repo instead.

## Using Claude Code

This repo is set up to work well with [Claude Code](https://claude.com/claude-code):

```bash
claude    # reads CLAUDE.md (which includes AGENTS.md) automatically
```

`AGENTS.md` documents the active stack, backend/auth/testing conventions, and the mandatory `just ci-check` gate — read it before making non-trivial changes. If you're using AI assistance of any kind, also see [AI_POLICY.md](AI_POLICY.md).
