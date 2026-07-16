import { describe, expect, test } from "bun:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

/**
 * Regression test for the bug this feature fixed: a FAILED migration must
 * exit non-zero. Before `src/db/migrate.ts` switched to a dedicated
 * synchronous, no-transport Pino instance (see the doc comment on `main` in
 * that file), the shared worker-transport `childLogger` stranded
 * `process.exit(1)` on failure — `logger.flush()`'s callback never fired
 * under Bun, so the process instead exited 0 via the runtime's own natural
 * exit once the unref'd worker thread's handle dropped, silently reporting
 * migration failures as success to the calling shell/CI.
 *
 * `src/db/migrate.ts` is a standalone script (self-invoking `main()...exit`),
 * so it must be exercised as a real subprocess — importing it in-process
 * would trigger its own `process.exit()` inside the test runner. Same pinned
 * Postgres image as `src/backup/__tests__/db-roundtrip.test.ts` and
 * `e2e/start-test-server.ts` (AWS ECR Public mirror, pre-pulled in CI).
 */
const POSTGRES_IMAGE =
  "public.ecr.aws/docker/library/postgres:17@sha256:5c855ad7b85e68e48a62f34662853f38b57c1c1d80f3a927ab58034fd6d31c5e";

async function runMigrate(
  databaseUrl: string,
): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/db/migrate.ts"],
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, output: stdout + stderr };
}

describe("migrate.ts — exit code (regression)", () => {
  test("a failed migration (unreachable DATABASE_URL) exits non-zero and logs the failure", async () => {
    // Syntactically valid but unreachable: a closed TCP port on loopback
    // (port 1 — reserved, never listening) fails the connection attempt
    // fast (ECONNREFUSED) rather than hanging on a routing timeout, keeping
    // this test deterministic and quick. No DB needs to be running for this
    // path — that's the point: config/connection failures must still exit 1.
    const { exitCode, output } = await runMigrate(
      "postgres://nouser:nopass@127.0.0.1:1/nope",
    );

    expect(exitCode).toBe(1);
    // Proves the sync logger flushed to stdout/stderr before process.exit —
    // the exact failure mode the fix addresses.
    expect(output).toContain("migration failed");
  }, 15_000);

  test("a successful migration against a fresh database exits 0", async () => {
    const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
      POSTGRES_IMAGE,
    )
      .withDatabase("magstacker_migrate_exit_test")
      .start();

    try {
      const { exitCode, output } = await runMigrate(
        container.getConnectionUri(),
      );

      expect(exitCode).toBe(0);
      expect(output).toContain("migrations applied");
    } finally {
      await container.stop();
    }
  }, 120_000);
});
