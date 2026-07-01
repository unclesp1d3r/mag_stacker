# End-to-end tests

Playwright end-to-end coverage for the inventory UI flows, backed by an
ephemeral [Testcontainers](https://testcontainers.com/) Postgres. Each run
provisions its own throwaway database, migrates and seeds it, boots a production
build of the app, runs the suite, and tears everything down — no dependency on
the dev Docker database.

## Running

```bash
bun run test:e2e        # headless, full suite
bun run test:e2e:ui     # Playwright UI mode
```

**Prerequisite: a running Docker daemon.** Testcontainers starts the Postgres
container (and its Ryuk reaper) over Docker. The first run also downloads the
Chromium build if it is missing:

```bash
bunx playwright install --with-deps chromium
```

## How the harness works

`playwright.config.ts` points `webServer.command` at `e2e/start-test-server.ts`,
the launcher that owns the whole backend lifecycle. Playwright starts
`webServer` *before* `globalSetup`, so the container cannot live in
`globalSetup` — the launcher owns it instead. On startup it:

1. Generates a random `BETTER_AUTH_SECRET` and admin credentials (nothing is
   hardcoded or committed).
2. Starts an ephemeral `postgres:17` container and takes its connection URI as
   `DATABASE_URL`.
3. Runs migrations (`src/db/migrate.ts`) and seeds the admin
   (`scripts/seed-admin.ts`).
4. Pre-seeds one throwaway user per spec and mints each session **in-process**
   (via `auth.handler`, rotating `x-forwarded-for` so the sign-in rate limit
   never trips), writing the tokens to `e2e/.artifacts/env.json`.
5. Serves a production build (`next start`) on a **free port reserved by
   `playwright.config.ts`** and passed in via `webServer.env` (so runs never
   clash with a dev server), with `BETTER_AUTH_URL` set to the same origin as
   the Playwright `baseURL` (Better Auth rejects a mismatched origin with a 403).

Teardown: the launcher stops the container on `SIGTERM`, and the Testcontainers
Ryuk reaper removes it when the launcher process exits regardless — so there are
no leaked containers (`docker ps` is clean after a run).

## Authentication

Specs never log in over HTTP on the happy path. Each fixture-backed spec calls
`authTest("<key>")` (`e2e/fixtures/auth.ts`), which loads that user's
pre-seeded session token as Playwright `storageState`. A distinct per-spec user
gives owner-scoped isolation, so inventory never leaks across specs. The one
exception is `auth.spec.ts`, which drives the real login form against the seeded
admin (the only spec that exercises `/sign-in/email`).

To add a fixture-backed spec, add its key to `SPEC_USER_KEYS` in
`e2e/fixtures/user-pool.ts` — the launcher then seeds it automatically.

## Conventions

- **No `data-testid`.** Locate elements by ARIA role, accessible name, or
  visible text (`getByRole`, `getByLabel`, `getByText`).
- `workers: 1`, `fullyParallel: false` — one container, one server, serialized
  specs. Isolation comes from per-user owner-scoping, not per-row cleanup.
- `e2e/.artifacts/` holds the run's generated credentials and session tokens. It
  is gitignored; never commit it (CI fails if it is).

## CI

The `e2e` job in `.github/workflows/ci.yml` runs the suite on `ubuntu-latest`
(which ships a Docker daemon for Testcontainers): it installs the Chromium
browser, pre-pulls `postgres:17`, builds the app, runs `bun run test:e2e`, and
uploads the `playwright-report/` artifact.
