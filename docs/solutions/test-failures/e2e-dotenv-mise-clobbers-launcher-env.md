---
title: Playwright e2e all land on /login locally — a dev .env clobbers the Testcontainers run env
date: 2026-07-03
category: test-failures
module: e2e-harness
problem_type: test_failure
component: testing_framework
symptoms:
  - "Every Playwright spec (including unchanged ones) times out waiting for post-login UI; the page snapshot shows the sign-in screen"
  - "CI e2e is green; only local runs fail"
  - "`getSession()` returns null even though the `better-auth.session_token` cookie is present on the request"
  - "The spawned app runs with the dev `.env` values (`:3100` / `localhost:5544/magstacker`), not the launcher's reserved port and Testcontainers DB (`.../magstacker_test`)"
root_cause: config_error
resolution_type: test_fix
severity: high
tags: [playwright, testcontainers, better-auth, mise, dotenv, bun, nextjs, e2e]
---

# Playwright e2e all land on /login locally — a dev .env clobbers the Testcontainers run env

## Problem

The Testcontainers-backed Playwright suite passed in CI but every spec failed locally, each landing on the login page. The `webServer` launcher (`e2e/start-test-server.ts`) resolves a per-run `DATABASE_URL` (the Testcontainers Postgres), `BETTER_AUTH_URL` (a reserved free port), and a random `BETTER_AUTH_SECRET`, then started `next start` **as a spawned subprocess**. That subprocess re-read the developer's local `.env` values (dev DB, dev origin) instead of the launcher's per-run env. Sessions are minted in-process against the container DB with the run's secret, so the app — reading the *dev* DB with the *dev* secret — rejected every session cookie and redirected to `/login`.

## Symptoms

- Every spec — even ones unrelated to the change and previously passing (theme, auth, onboarding) — times out (e.g. `getByRole("button", { name: "Add your first firearm" })` never resolves); the captured page snapshot is the "Sign in to your inventory" screen.
- `bun run test:e2e` fails locally; the same suite is green in CI.
- `.env` is **gitignored**, so CI has none — this is the local/CI split.

## What Didn't Work

- **Hiding `.env` for the run** (rename before the app spawns, restore on exit): the app *still* read `:3100`/`:5544`, which proved the `.env` *file* was not the live source — mise (`env_cache = true`, `_.file = ['.env', ...]`) caches and re-injects those values. It was also fragile: Playwright hard-kills the `webServer` (SIGKILL), which skipped the restore and left `.env` renamed.
- **`bun run --no-env-file start`**: no effect — Next's own `@next/env` loads `.env` independently of bun, so bun opting out doesn't stop it.
- **Trusting `spawn(..., { env: process.env })`**: the launcher's `process.env` is correct *at spawn time* (verified by instrumentation), but bun/Next/mise re-apply the dev env inside the child before any app module reads it.
- **A `start-app.ts` argv shim** (an earlier fix that *worked* but was replaced): a wrapper the launcher spawned instead of `next start`, which forced the three vars from `process.argv` before `import("next/dist/bin/next")`. It passed all specs, but it leaked the secret onto the command line, reconstructed `process.argv`, and imported an internal bin — a workaround for a subprocess that should not have existed. Superseded by serving Next in-process (below).

## Solution

Serve Next **in-process** from the launcher via its programmatic API instead of spawning a `next start` subprocess. The launcher already sets the run's env in `process.env`, and with no child process there is nothing to re-load `.env`/mise and clobber it (`@next/env` only fills *unset* vars, so the launcher's values survive):

```ts
// e2e/start-test-server.ts
import { nextStart } from "next/dist/cli/next-start";

// … container up, migrated, seeded, sessions minted, app built:
await nextStart({ port: PORT, hostname: "localhost" });
```

`nextStart` resolves once the server is listening; the open socket keeps the launcher process alive, and its existing SIGINT/SIGTERM trap stops the container on teardown (Ryuk reaps as a backstop). This is the production-server analog of the `next/dist/cli/next-dev` `nextDev()` pattern used by community Testcontainers + Next.js e2e templates. Result: all 13 e2e specs pass locally; CI (no `.env`) is unaffected.

## Why This Works

The env-clobbering only happened because a **child process** re-acquired the dev env (via bun's `.env` auto-load, Next's `@next/env`, or mise's `env_cache`) after inheriting the launcher's correct env. Running Next in the launcher's *own* process removes that seam entirely: there is no exec that re-triggers `.env`/mise loading, and `@next/env`, which preserves keys already present in `process.env`, keeps the launcher's `DATABASE_URL`/`BETTER_AUTH_URL`/`BETTER_AUTH_SECRET`. The secret matters as much as the DB: sessions are minted with the launcher's random `BETTER_AUTH_SECRET`, so the server must validate the cookie HMAC with that same secret — the dev secret would reject the cookie even against the right DB.

## Prevention

- In Testcontainers / ephemeral-env harnesses, don't spawn the app as a subprocess and rely on `env` inheritance — bun and Next both auto-load `.env`, and mise `env_cache` re-injects it. Start the app **in-process** (Next's `nextStart`/`nextDev`), or make the whole e2e config static (dedicated `.env.e2e` + fixed ports, the template approach) so there is nothing dynamic to inject.
- Remember the CI/local gap: `.env` is gitignored, so a harness that is green in CI can still be broken locally. Reproduce locally with a dev `.env` present; instrument the actual read site (`getSession`, DB client) to see the *runtime* env, not the launcher's.
- Secondary spec-authoring gotchas surfaced here: required fields render their label as `"Name *"` (asterisk `<span>`), so once a sibling `"Nickname"` field exists, match with `getByLabel(/^Name/)` — exact `"Name"` matches neither `"Name *"` nor `"Nickname"`; and use `.first()` on completion toasts when a spec creates several records in a row, since the toasts stack and a bare `getByText("Firearm logged")` resolves to multiple elements.

## Related Issues

- Surfaced while adding the firearm nickname feature (#18) and its e2e spec.
- `AGENTS.md` documents the adjacent mise sticky-env gotcha (`env_cache=true`, default `:3000` / full-setup `:3100` origin) and warns that `BETTER_AUTH_URL` must equal the request origin.
- Reference pattern: `varianter/testcontainers-nextjs-template` (in-process `nextDev`, dedicated `.env.e2e`, fixed ports).
