import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { POSTGRES_IMAGE, TEST_DB_NAME } from "./postgres-image";

/**
 * Bun test preload: give every `bun test` run its own migrated Postgres.
 *
 * Wired via `bunfig.toml` (`[test] preload`), so it runs once per test process
 * before any test module is imported.
 *
 * Why this exists: the integration suite used to gate on an ambient
 * `DATABASE_URL` — `const live = process.env.DATABASE_URL ? describe :
 * describe.skip` — which pointed at a hand-started dev database that is not
 * described anywhere in this repo (`justfile` states outright that there is no
 * compose stack). That had three failure modes, all of which we hit:
 *
 *   1. No database running → 100+ connection failures, not skips, because the
 *      gate only checks that the *variable* is set, never that the server is
 *      reachable.
 *   2. Database running but seeded (e.g. by `just db-seed`) → tests that count
 *      or list rows fail against someone else's data.
 *   3. Tests silently skipping in any environment that simply never set the
 *      variable, reporting green while asserting nothing.
 *
 * An ephemeral container removes all three: the database always exists, always
 * starts empty, and is never shared with development data.
 *
 * **Top-level await is deliberate.** `DATABASE_URL` must be set before the
 * first test module is *imported*, not merely before the first test runs —
 * module-scope code reads it. A `beforeAll` hook would run too late.
 *
 * Teardown is Ryuk's job (the Testcontainers reaper removes the container when
 * this process exits, including on crash or kill), matching how the e2e
 * launcher treats its own container. The explicit stop below is the fast path,
 * not the guarantee.
 */

const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
  POSTGRES_IMAGE,
)
  .withDatabase(TEST_DB_NAME)
  .start();

process.env.DATABASE_URL = container.getConnectionUri();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./src/db/migrations" });
} finally {
  await pool.end();
}

// Best-effort fast teardown. Registered once; Ryuk still reaps if we never get
// here (SIGKILL, hard crash), which is why this is not the guarantee.
let stopped = false;
const stop = (): void => {
  if (stopped) return;
  stopped = true;
  void container.stop().catch(() => {
    // Ryuk will reap it; a failed stop must never fail the test run.
  });
};
process.on("exit", stop);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
