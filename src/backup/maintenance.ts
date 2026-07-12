/**
 * Force-restore maintenance envelope (plan Unit U5, KTD5): a durable,
 * crash-recoverable "restore in progress" flag plus a pool-safe advisory
 * lock, both scoped OUTSIDE the `public` schema so they never show up as
 * live application tables (and so U3's `db-roundtrip.test.ts` regression
 * guard — which asserts `EXPORT_TABLE_ORDER` + `EPHEMERAL_TABLE_NAMES` cover
 * every `public`-schema table exactly — stays green without needing to know
 * about restore's own bookkeeping).
 *
 * **Durable flag.** A single-row table (`restore_ops.maintenance_flag`)
 * rather than an in-memory flag: the flag must survive a process restart so
 * a crash mid-force-restore is still visible afterward. Crash-recovery
 * contract (consumed by future tooling, not built here — U5 only owns the
 * flag primitive): `active = true` together with a still-present
 * `restore_snapshot` schema (see `restore-service.ts`) signals an
 * interrupted force-restore; `active = true` with no snapshot schema means
 * the crash happened before the risky section began and nothing live was
 * touched.
 *
 * **Pool-safe advisory lock.** `withRestoreAdvisoryLock` holds ONE
 * `pool.connect()`-checked-out client for its entire duration and issues a
 * *session*-scoped `pg_advisory_lock`/`pg_advisory_unlock` pair on that same
 * connection, explicitly unlocking before releasing it back to the pool.
 * A session-scoped lock acquired through the *shared* pool (i.e. letting the
 * pool hand out whichever connection is free for the lock call, then a
 * different one for later statements) would be unsafe — the lock would be
 * held by a connection this code no longer has a handle on, and releasing
 * that connection back to the pool without unlocking would leak the lock for
 * the connection's lifetime. Dedicating and holding a single connection for
 * the whole envelope avoids that.
 */

import { sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import type { DbOrTx } from "@/src/db/client";

const MAINTENANCE_SCHEMA = "restore_ops";
const MAINTENANCE_TABLE = "maintenance_flag";

/**
 * Fixed application-specific advisory-lock key for the force-restore
 * envelope. Arbitrary but must stay stable and must not collide with any
 * other advisory lock key introduced elsewhere in the app (none exist yet).
 */
const RESTORE_ADVISORY_LOCK_KEY = 847_362_910_123;

function qualified(schemaName: string, name: string) {
  return sql`${sql.identifier(schemaName)}.${sql.identifier(name)}`;
}

/**
 * Creates the maintenance schema/table/singleton-row if they don't already
 * exist. Idempotent and cheap (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`) —
 * safe to call before every read or write of the flag rather than requiring
 * a separate migration step.
 */
async function ensureMaintenanceInfrastructure(db: DbOrTx): Promise<void> {
  await db.execute(
    sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(MAINTENANCE_SCHEMA)}`,
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${qualified(MAINTENANCE_SCHEMA, MAINTENANCE_TABLE)} (
      id boolean PRIMARY KEY DEFAULT true,
      active boolean NOT NULL DEFAULT false,
      reason text,
      started_at timestamptz,
      CONSTRAINT maintenance_flag_singleton CHECK (id)
    )
  `);
  await db.execute(sql`
    INSERT INTO ${qualified(MAINTENANCE_SCHEMA, MAINTENANCE_TABLE)} (id, active)
    VALUES (true, false)
    ON CONFLICT (id) DO NOTHING
  `);
}

/** True while a force-restore's write-blocking envelope is in progress. */
export async function isMaintenanceActive(db: DbOrTx): Promise<boolean> {
  await ensureMaintenanceInfrastructure(db);
  const result = await db.execute<{ active: boolean }>(sql`
    SELECT active FROM ${qualified(MAINTENANCE_SCHEMA, MAINTENANCE_TABLE)}
    WHERE id = true
  `);
  return result.rows[0]?.active ?? false;
}

/** Sets the durable flag active. Must be called before the risky section of a force-restore begins. */
export async function enterMaintenance(
  db: DbOrTx,
  reason: string,
): Promise<void> {
  await ensureMaintenanceInfrastructure(db);
  await db.execute(sql`
    UPDATE ${qualified(MAINTENANCE_SCHEMA, MAINTENANCE_TABLE)}
    SET active = true, reason = ${reason}, started_at = now()
    WHERE id = true
  `);
}

/** Clears the durable flag. Always called from a `finally`, on both success and rollback. */
export async function exitMaintenance(db: DbOrTx): Promise<void> {
  await ensureMaintenanceInfrastructure(db);
  await db.execute(sql`
    UPDATE ${qualified(MAINTENANCE_SCHEMA, MAINTENANCE_TABLE)}
    SET active = false, reason = NULL, started_at = NULL
    WHERE id = true
  `);
}

/**
 * Runs `fn` with the force-restore advisory lock held on a single dedicated
 * connection for `fn`'s entire duration (see module doc comment for why this
 * must not be a session lock acquired through the shared pool at large).
 * `fn` receives that same `PoolClient` so it can run its own
 * transactions/queries on the identical connection without contending with
 * itself for the lock.
 */
export async function withRestoreAdvisoryLock<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [
      RESTORE_ADVISORY_LOCK_KEY,
    ]);
    try {
      return await fn(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [
        RESTORE_ADVISORY_LOCK_KEY,
      ]);
    }
  } finally {
    client.release();
  }
}
