import { defineConfig } from "@playwright/test";
import { getFreePort } from "./e2e/free-port";

/**
 * Playwright E2E configuration (issue #6).
 *
 * The suite runs against a production build of the app served on a free port
 * reserved here, backed by an ephemeral Testcontainers Postgres. The
 * `webServer.command` launcher (`e2e/start-test-server.ts`) owns the container
 * lifecycle: it must start the DB, migrate, seed, pre-seed the per-spec user
 * pool, and write the resolved-env artifact *before* the app boots — which is
 * why the container cannot live in `globalSetup` (Playwright starts `webServer`
 * before `globalSetup` runs). See KTD1.
 *
 * The app port is reserved dynamically (not hardcoded) and handed to the
 * launcher via `webServer.env`, which binds it and sets `BETTER_AUTH_URL` to the
 * same origin (Better Auth rejects a mismatched origin with a 403). The Postgres
 * port is likewise dynamic — the launcher takes it from `getConnectionUri()`.
 *
 * `workers: 1` / `fullyParallel: false`: isolation is owner-scoping (each spec
 * authenticates as its own pre-seeded user), and the single ephemeral container
 * is dropped wholesale at teardown, so specs run serially against one server.
 */
/**
 * Resolve the app port once, then memoize it in the environment. Playwright
 * re-evaluates this config in each worker process, and a fresh getFreePort()
 * per evaluation would make the workers' baseURL diverge from the port the
 * launcher actually bound. Workers inherit E2E_PORT from the main process (the
 * one that started webServer), so the first resolution wins for the whole run.
 */
function resolveAppPort(): number {
  const existing = Number(process.env.E2E_PORT);
  if (Number.isInteger(existing) && existing > 0) return existing;
  const port = getFreePort();
  process.env.E2E_PORT = String(port);
  return port;
}

const port = resolveAppPort();
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run e2e/start-test-server.ts",
    url: baseURL,
    // Hand the reserved port to the launcher (it binds it + sets BETTER_AUTH_URL).
    env: { E2E_PORT: String(port) },
    // Never reuse: the launcher does essential setup (provisions Postgres,
    // writes the auth artifact the fixtures read), not just `next start`.
    reuseExistingServer: false,
    // 5-minute budget covers a cold `next build` plus container start on CI.
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
