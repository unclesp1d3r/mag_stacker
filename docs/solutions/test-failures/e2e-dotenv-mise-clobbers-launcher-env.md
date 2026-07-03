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

The Testcontainers-backed Playwright suite passed in CI but every spec failed locally, each landing on the login page. The `webServer` launcher (`e2e/start-test-server.ts`) resolves a per-run `DATABASE_URL` (the Testcontainers Postgres), `BETTER_AUTH_URL` (a reserved free port), and a random `BETTER_AUTH_SECRET`, then spawns `next start`. But the spawned app read the developer's local `.env` values instead — dev DB and dev origin. Sessions are pre-seeded/minted in-process against the container DB with the run's secret, so the app (reading the *dev* DB with the *dev* secret) rejected every session cookie and redirected to `/login`.

## Symptoms

- Every spec — even ones unrelated to the change and previously passing (theme, auth, onboarding) — times out (e.g. `getByRole("button", { name: "Add your first firearm" })` never resolves); the captured page snapshot is the "Sign in to your inventory" screen.
- `bun run test:e2e` fails locally; the same suite is green in CI.
- `.env` is **gitignored**, so CI has none — this is the local/CI split.

## What Didn't Work

- **Hiding `.env` for the run** (rename before the app spawns, restore on exit): the app *still* read `:3100`/`:5544`, which proved the `.env` *file* was not the live source — mise (`env_cache = true`, `_.file = ['.env', ...]`) caches and re-injects those values, and bun/Next also re-load. It was also fragile: Playwright hard-kills the `webServer` (SIGKILL), which skipped the restore and left `.env` renamed.
- **`bun run --no-env-file start`**: no effect — Next's own `@next/env` loads `.env` independently of bun, so bun opting out doesn't stop it.
- **Trusting `spawn(..., { env: process.env })`**: the launcher's `process.env` is correct *at spawn time* (verified by instrumentation), but bun/Next/mise re-apply the dev `.env` inside the child before any app module reads it.

## Solution

Spawn an in-process shim (`e2e/start-app.ts`) instead of `next start`. It takes the run's values as **argv** and forces them into `process.env` *after* any env auto-load and *before* Next reads them, then hands off in the same process:

```ts
// e2e/start-app.ts — bun e2e/start-app.ts <dbUrl> <authUrl> <authSecret> -p <port>
export {}; // module, so top-level await is allowed
const [dbUrl, authUrl, authSecret, ...nextArgs] = process.argv.slice(2);
process.env.DATABASE_URL = dbUrl;
process.env.BETTER_AUTH_URL = authUrl;
process.env.BETTER_AUTH_SECRET = authSecret;
process.argv = [process.argv[0], "next", "start", ...nextArgs];
await import("next/dist/bin/next"); // starts Next in THIS process — no re-load
```

Launcher change:

```ts
child = spawn(
  process.execPath,
  [
    "e2e/start-app.ts",
    process.env.DATABASE_URL ?? "",
    process.env.BETTER_AUTH_URL ?? "",
    process.env.BETTER_AUTH_SECRET ?? "",
    "-p",
    String(PORT),
  ],
  { stdio: "inherit", env: process.env },
);
```

Result: all 13 e2e specs pass locally; CI (no `.env`) is unaffected because the shim just re-asserts values that were already correct there.

## Why This Works

`@next/env` snapshots `process.env` on its first call and only *fills unset* keys from `.env` files — it preserves keys already present. Setting the three vars in the shim **before** `import("next/dist/bin/next")` guarantees they're in that snapshot, so Next keeps them. Passing them as **argv** (not merely inheriting them through the env) makes them authoritative no matter where the override originates — bun's `.env` auto-load, Next's `@next/env`, or mise's `env_cache`. The secret is load-bearing too: sessions are minted with the launcher's random `BETTER_AUTH_SECRET`, so the app must validate the cookie HMAC with that *same* secret — the dev `.env` secret would reject the cookie even against the right DB.

## Prevention

- In Testcontainers / ephemeral-env harnesses, never assume `spawn({ env: process.env })` survives into the child: bun and Next both auto-load `.env`, and mise `env_cache` re-injects it. Force run-critical vars in-process, via argv, right before the framework reads them.
- Remember the CI/local gap: `.env` is gitignored, so a harness that is green in CI can still be broken locally. Reproduce locally with a dev `.env` present; instrument the actual read site (`getSession`, DB client) to see the *runtime* env, not the launcher's.
- Secondary spec-authoring gotchas surfaced here: required fields render their label as `"Name *"` (asterisk `<span>`), so once a sibling `"Nickname"` field exists, match with `getByLabel(/^Name/)` — exact `"Name"` matches neither `"Name *"` nor `"Nickname"`; and use `.first()` on completion toasts when a spec creates several records in a row, since the toasts stack and a bare `getByText("Firearm logged")` resolves to multiple elements.

## Related Issues

- Surfaced while adding the firearm nickname feature (#18) and its e2e spec.
- `AGENTS.md` documents the adjacent mise sticky-env gotcha (`env_cache=true`, default `:3000` / full-setup `:3100` origin) and warns that `BETTER_AUTH_URL` must equal the request origin.
