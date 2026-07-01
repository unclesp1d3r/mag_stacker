import { defineConfig } from "@playwright/test";

/**
 * Playwright E2E configuration (issue #6).
 *
 * The suite runs against a production build of the app served on a dedicated
 * test port (3210), backed by an ephemeral Testcontainers Postgres. The
 * `webServer.command` launcher (`e2e/start-test-server.ts`) owns the container
 * lifecycle: it must start the DB, migrate, seed, pre-seed the per-spec user
 * pool, and write the resolved-env artifact *before* the app boots — which is
 * why the container cannot live in `globalSetup` (Playwright starts `webServer`
 * before `globalSetup` runs). See KTD1.
 *
 * `workers: 1` / `fullyParallel: false`: isolation is owner-scoping (each spec
 * authenticates as its own pre-seeded user), and the single ephemeral container
 * is dropped wholesale at teardown, so specs run serially against one server.
 */
const PORT = 3210;
const baseURL = `http://localhost:${PORT}`;

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
    reuseExistingServer: !process.env.CI,
    // 5-minute budget covers a cold `next build` plus container start on CI.
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
