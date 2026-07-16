import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import pino from "pino";
import { mintCorrelationId, runWithContext } from "@/src/lib/logging/context";
import { resolveLogEnv } from "@/src/lib/logging/env";
import { requireDatabaseUrl } from "./env";

/**
 * A dedicated, synchronous, no-transport Pino instance — deliberately NOT
 * the shared `childLogger` from `src/lib/logging` (documented deviation from
 * the plan's original instruction, see the module doc comment on `main`
 * below for why).
 *
 * `pino({ level })` with no `transport`/`stream` option falls back to Pino's
 * default destination: a `SonicBoom` writing synchronously to fd 1. That
 * means every `log.info`/`log.error` call below has fully written its line
 * to stdout before the next statement runs — no worker thread, no async
 * flush to race against `process.exit()`. `level` still honors `LOG_LEVEL`
 * (via `resolveLogEnv`) for parity with the shared logger's level semantics;
 * `.child({ module: "migrate" })` matches the shared `childLogger`'s output
 * shape (a `module` field on every line).
 */
const log = pino({ level: resolveLogEnv().level }).child({
  module: "migrate",
});

/** Minted once per invocation (R11) and reused on both the success and
 * failure log lines below, since a single CLI run is one unit of work
 * regardless of outcome. */
const correlationId = mintCorrelationId();

/**
 * Apply all pending migrations against `DATABASE_URL`, then exit.
 *
 * Run explicitly (`bun run db:migrate`) or as the stack's migrate step on
 * container start. Drizzle records applied migrations in `__drizzle_migrations`,
 * so re-running is idempotent — already-applied migrations are skipped.
 *
 * A standalone CLI invocation has no ambient request/action context, so it
 * mints its own correlation id per run (R11) and threads it through the
 * whole body via `runWithContext` — this still seeds the shared ALS store
 * (in case anything invoked from here ever grows a dependency on the shared
 * `childLogger`), and the id is also bound directly onto this file's local
 * `log` below so it actually appears on these lines regardless.
 *
 * **Deviation from the original plan instruction:** the plan called for
 * reusing the shared worker-transport `childLogger` here with an explicit
 * `logger.flush()` drain before `process.exit()`. Empirically, under Bun,
 * `pino`'s `logger.flush(cb)` callback never fired for this script before
 * the process would otherwise exit (verified directly: a debug line placed
 * immediately after the `flush` callback never printed). Two consequences
 * made that unacceptable for a one-shot CLI: (1) the pending log write could
 * be silently dropped, and (2) far worse, this script's own
 * `process.exit(1)` on failure was *never reached* — only the runtime's own
 * natural, always-code-0 exit ran once the (unref'd) worker thread's handle
 * dropped — which would have silently turned every migration **failure**
 * into a reported **success** (exit code 0) to the calling shell/CI. The
 * minimal synchronous instance above sidesteps the whole class of failure:
 * confirmed by direct testing (`bun run src/db/migrate.ts` against a good
 * `DATABASE_URL` prints the success line and exits 0; against an
 * unreachable `DATABASE_URL` it prints the error line and exits 1).
 */
async function main(): Promise<void> {
  await runWithContext({ correlationId, module: "migrate" }, async () => {
    const pool = new Pool({ connectionString: requireDatabaseUrl() });
    const db = drizzle(pool);
    try {
      await migrate(db, { migrationsFolder: "./src/db/migrations" });
      log.info({ correlationId }, "migrations applied");
    } finally {
      await pool.end();
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    log.error({ err: error, correlationId }, "migration failed");
    process.exit(1);
  });
