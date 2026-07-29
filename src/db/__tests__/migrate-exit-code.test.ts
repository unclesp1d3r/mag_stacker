import { describe, expect, test } from "bun:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { POSTGRES_IMAGE } from "../../test-support/postgres-image";

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

// The container-backed success path is a Postgres integration test — gate it
// on DATABASE_URL like the rest of the suite so environments without
// integration infrastructure skip it cleanly. The failure path needs no DB
// (it deliberately targets a closed port) and always runs.

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
