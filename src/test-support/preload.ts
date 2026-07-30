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
 * **This assumes `bun test` runs matched files sequentially in one process**,
 * which it does today (there is no `--shard`/parallel flag in `package.json` or
 * CI). One container is shared by every test file, and `src/backup/__tests__/
 * routes.test.ts` additionally repoints `DATABASE_URL` at its own container and
 * restores it afterward. Enabling parallel or sharded execution would break both
 * — each worker would need its own container, and the repointing would race.
 *
 * Teardown is Ryuk's job (the Testcontainers reaper removes the container when
 * this process exits, including on crash or kill), matching how the e2e
 * launcher treats its own container. The signal handlers below only cover
 * Ctrl-C/SIGTERM, where they also have to terminate the process explicitly —
 * registering a signal listener replaces the default exit behavior.
 */

const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
  POSTGRES_IMAGE,
)
  .withDatabase(TEST_DB_NAME)
  .start()
  .catch((cause: unknown) => {
    // Without this the first thing a developer sees is a testcontainers socket
    // stack trace, which does not name the actual problem.
    throw new Error(
      "Could not start the ephemeral test Postgres container — is Docker running?",
      { cause },
    );
  });

process.env.DATABASE_URL = container.getConnectionUri();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./src/db/migrations" });
} catch (cause) {
  throw new Error("Could not migrate the ephemeral test database.", { cause });
} finally {
  await pool.end();
}

/**
 * Stop the container on Ctrl-C or a supervisor's SIGTERM.
 *
 * Registering a signal listener REPLACES the default terminate-on-signal
 * behavior, so this has to exit the process itself or Ctrl-C would leave the run
 * hanging with no output. There is deliberately no `process.on("exit")`
 * counterpart: that handler must be synchronous, so it could never await
 * `container.stop()` — it would read as cleanup while doing nothing. Ryuk is the
 * real guarantee for every other exit path, including a crash or SIGKILL.
 */
let stopping = false;
const stopAndExit = (): void => {
  if (stopping) return;
  stopping = true;
  void container
    .stop()
    // A failed stop must not change the exit path; Ryuk still reaps it.
    .catch(() => {})
    .finally(() => process.exit(0));
};
process.on("SIGINT", stopAndExit);
process.on("SIGTERM", stopAndExit);
