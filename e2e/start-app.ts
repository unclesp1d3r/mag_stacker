/**
 * E2E app entrypoint shim.
 *
 * The launcher (`start-test-server.ts`) resolves this run's DATABASE_URL
 * (Testcontainers), BETTER_AUTH_URL (the reserved port), and BETTER_AUTH_SECRET
 * (random) and passes them here as argv. A local dev `.env` — re-loaded by
 * bun/Next or re-injected by mise's `env_cache` (gitignored, so absent in CI) —
 * otherwise clobbers those in the spawned app, which then reads the dev DB and
 * dev origin; sessions are minted in-process against the container DB with the
 * run's random secret, so the mismatched app rejects every session cookie and
 * each spec lands on the login page.
 *
 * Running in-process, this shim forces the three values from argv AFTER any env
 * auto-load and BEFORE Next reads them — Next's `@next/env` snapshots the current
 * `process.env` and preserves already-set keys — then hands off to `next start`.
 * Passing them as argv (not merely inheriting them) is what makes them win
 * regardless of where the override originates.
 *
 * Usage: bun e2e/start-app.ts <dbUrl> <authUrl> <authSecret> -p <port>
 */
export {}; // top-level await below requires this file to be a module

const [dbUrl, authUrl, authSecret, ...nextArgs] = process.argv.slice(2);
if (!dbUrl || !authUrl || !authSecret) {
  throw new Error(
    "start-app: expected <dbUrl> <authUrl> <authSecret> followed by next-start args",
  );
}

process.env.DATABASE_URL = dbUrl;
process.env.BETTER_AUTH_URL = authUrl;
process.env.BETTER_AUTH_SECRET = authSecret;

// Hand off to `next start` in this same process (no child that would re-load
// `.env`). Next's bin reads process.argv, so shape it as `node next start …`.
process.argv = [process.argv[0], "next", "start", ...nextArgs];
await import("next/dist/bin/next");
