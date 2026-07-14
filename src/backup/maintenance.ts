/**
 * Restore maintenance envelope (plan Unit U5, KTD5): a durable,
 * crash-recoverable "restore in progress" flag plus a pool-safe advisory
 * lock, both scoped OUTSIDE the `public` schema so they never show up as
 * live application tables (and so U3's `db-roundtrip.test.ts` regression
 * guard — which asserts `EXPORT_TABLE_ORDER` + `EPHEMERAL_TABLE_NAMES` cover
 * every `public`-schema table exactly — stays green without needing to know
 * about restore's own bookkeeping). Entered for EVERY restore promote —
 * empty-instance (F2) and force-replace (F3) alike, see
 * `restore-service.ts`'s `promote` — not just force-restore.
 *
 * **Durable flag.** A single-row table (`restore_ops.maintenance_flag`)
 * rather than an in-memory flag: the flag must survive a process restart so
 * a crash mid-restore is still visible afterward. The row also records which
 * `restore_snapshot_*` schema (if any) belongs to the in-progress restore
 * (`recordMaintenanceSnapshotSchema`) — this is what lets
 * `recoverInterruptedRestore` tell "crashed before the risky section began,
 * nothing live touched" (`active = true`, no recorded snapshot) apart from
 * "crashed mid wipe+promote, live data may be in the new OR old state"
 * (`active = true`, a recorded snapshot schema that still exists).
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
 * the whole envelope avoids that. `restore()` (`restore-service.ts`) now
 * holds this lock for its ENTIRE body — staging through promote, for both
 * the empty-instance and force paths — so two concurrent restore attempts
 * fully serialize instead of racing to promote into `public` at the same
 * time. Nothing else in this module re-acquires the lock (it is NOT
 * reentrant across connections: a second `pg_advisory_lock` call for the
 * same key on a different session blocks until the first session releases
 * it, so calling this from inside an already-locked section would deadlock).
 *
 * **Write-blocking guard.** `assertWritesAllowed` lets the ordinary
 * (non-restore) write path refuse writes for as long as the flag is active,
 * so a request that lands mid-restore fails fast with a clear
 * `MaintenanceModeError` instead of racing the restore's own wipe+promote.
 */

import type { Dirent } from "node:fs";
import { readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getTableName, sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import type { DbOrTx } from "@/src/db/client";
import { EXPORT_TABLE_ORDER, WIPE_TABLE_ORDER } from "./table-order";

const MAINTENANCE_SCHEMA = "restore_ops";
const MAINTENANCE_TABLE = "maintenance_flag";

/**
 * Prefix every per-run staging schema `restore-service.ts` creates is named
 * with (`${STAGING_SCHEMA_PREFIX}<hex run id>`). Exported so
 * `recoverInterruptedRestore`'s leftover-schema sweep and
 * `restore-service.ts`'s own per-run naming share one source of truth.
 */
export const STAGING_SCHEMA_PREFIX = "restore_staging_";

/**
 * Prefix every per-run pre-restore snapshot schema `restore-service.ts`
 * creates is named with (`${SNAPSHOT_SCHEMA_PREFIX}<hex run id>`). See
 * {@link STAGING_SCHEMA_PREFIX}.
 */
export const SNAPSHOT_SCHEMA_PREFIX = "restore_snapshot_";

/** Prefix every staging blob directory `restore-service.ts` creates (a sibling of the upload dir) is named with. */
const STAGING_BLOB_DIR_PREFIX = "restore-staging-";

/** Infix (before a random id) every moved-aside pre-restore blob directory is named with — a sibling of the upload dir. */
const PRE_RESTORE_BLOB_DIR_INFIX = ".pre-restore-";

/**
 * Fixed application-specific advisory-lock key for the force-restore
 * envelope. Arbitrary but must stay stable and must not collide with any
 * other advisory lock key introduced elsewhere in the app (none exist yet).
 */
const RESTORE_ADVISORY_LOCK_KEY = 847_362_910_123;

function qualified(schemaName: string, name: string) {
  return sql`${sql.identifier(schemaName)}.${sql.identifier(name)}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

function logRecoveryFailure(step: string, err: unknown): void {
  // Crash recovery must never throw out of `recoverInterruptedRestore` (it
  // runs from `instrumentation.ts`'s `register()`, and a thrown error there
  // would fail the whole server's boot) — every failure is logged instead.
  console.error(`backup/maintenance: recovery step "${step}" failed`, err);
}

/** Postgres SQLSTATE for "undefined_table" (a relation referenced in a query doesn't exist). */
const POSTGRES_UNDEFINED_TABLE = "42P01";

function hasUndefinedTableCode(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === POSTGRES_UNDEFINED_TABLE
  );
}

/**
 * True when `err` is a Postgres error whose SQLSTATE is `undefined_table`
 * (`42P01`) — i.e. a query referenced a relation that doesn't exist. Used by
 * {@link assertWritesAllowed} to distinguish "the maintenance infra was never
 * created" (fail open) from any other, genuine failure (propagate).
 *
 * Drizzle's node-postgres driver wraps the raw `pg` error (which carries
 * `.code`) in its own `DrizzleQueryError`, with the original error on
 * `.cause` — the SQLSTATE isn't on the outer error, so both layers must be
 * checked.
 */
function isUndefinedTableError(err: unknown): boolean {
  if (hasUndefinedTableCode(err)) return true;
  if (err instanceof Error && err.cause) {
    return hasUndefinedTableCode(err.cause);
  }
  return false;
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
  // Added after the table's original shape (KTD5 hardening follow-up) —
  // `IF NOT EXISTS` keeps this safe to re-run against a table created by an
  // older version of this module.
  await db.execute(sql`
    ALTER TABLE ${qualified(MAINTENANCE_SCHEMA, MAINTENANCE_TABLE)}
    ADD COLUMN IF NOT EXISTS snapshot_schema text
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

/** Sets the durable flag active. Must be called before the risky section of a force-restore begins. Clears any previously-recorded snapshot schema, so a fresh attempt always starts clean. */
export async function enterMaintenance(
  db: DbOrTx,
  reason: string,
): Promise<void> {
  await ensureMaintenanceInfrastructure(db);
  await db.execute(sql`
    UPDATE ${qualified(MAINTENANCE_SCHEMA, MAINTENANCE_TABLE)}
    SET active = true, reason = ${reason}, started_at = now(), snapshot_schema = NULL
    WHERE id = true
  `);
}

/**
 * Records which `restore_snapshot_*` schema belongs to the currently
 * in-progress force-restore. Must only be called once that schema has been
 * fully created and committed (i.e. it is genuinely safe to roll back from)
 * — this is the single durable signal `recoverInterruptedRestore` uses to
 * decide whether a crash happened before or during the risky wipe+promote
 * section.
 */
export async function recordMaintenanceSnapshotSchema(
  db: DbOrTx,
  snapshotSchema: string,
): Promise<void> {
  await ensureMaintenanceInfrastructure(db);
  await db.execute(sql`
    UPDATE ${qualified(MAINTENANCE_SCHEMA, MAINTENANCE_TABLE)}
    SET snapshot_schema = ${snapshotSchema}
    WHERE id = true
  `);
}

/** Clears the durable flag (including the recorded snapshot schema). Always called from a `finally`, on both success and rollback. */
export async function exitMaintenance(db: DbOrTx): Promise<void> {
  await ensureMaintenanceInfrastructure(db);
  await db.execute(sql`
    UPDATE ${qualified(MAINTENANCE_SCHEMA, MAINTENANCE_TABLE)}
    SET active = false, reason = NULL, started_at = NULL, snapshot_schema = NULL
    WHERE id = true
  `);
}

interface MaintenanceFlagState {
  readonly active: boolean;
  readonly snapshotSchema: string | null;
}

async function readMaintenanceFlag(db: DbOrTx): Promise<MaintenanceFlagState> {
  await ensureMaintenanceInfrastructure(db);
  const result = await db.execute<{
    active: boolean;
    snapshot_schema: string | null;
  }>(sql`
    SELECT active, snapshot_schema
    FROM ${qualified(MAINTENANCE_SCHEMA, MAINTENANCE_TABLE)}
    WHERE id = true
  `);
  const row = result.rows[0];
  return {
    active: row?.active ?? false,
    snapshotSchema: row?.snapshot_schema ?? null,
  };
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

/**
 * Thrown by {@link assertWritesAllowed} when the instance is under a
 * force-restore's write-blocking maintenance window.
 */
export class MaintenanceModeError extends Error {
  constructor(
    message = "instance is under maintenance (restore in progress); try again shortly",
  ) {
    super(message);
    this.name = "MaintenanceModeError";
  }
}

/**
 * Write-blocking guard for the ordinary (non-restore) write path: throws
 * {@link MaintenanceModeError} while a force-restore's maintenance window is
 * active, otherwise resolves normally. Callers should call this immediately
 * before performing a write, not cache the result — the window can open or
 * close at any time.
 *
 * Deliberately NOT built on {@link isMaintenanceActive}: this runs on every
 * ordinary write across the app (every create/update/delete/grant/settings-
 * change/admin-user-op), not just the restore path, so it must stay a single
 * cheap `SELECT` rather than also paying for `ensureMaintenanceInfrastructure`'s
 * `CREATE SCHEMA/TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`
 * + `INSERT ... ON CONFLICT` on every call. If the maintenance schema/table
 * don't exist yet — no force-restore has ever run against this instance, so
 * nothing ever created them — Postgres raises `42P01` (undefined_table) for
 * the `SELECT`; that is treated as "maintenance was never entered" and writes
 * are allowed (fail open), not surfaced as an error. Any other error
 * propagates.
 *
 * The `SELECT` runs inside `db.transaction(...)` rather than as a bare
 * `db.execute(...)` — NOT for atomicity, but because most callers pass an
 * already-open transaction (`tx`) they're about to keep using for the write
 * itself. A statement that errors inside a Postgres transaction aborts that
 * whole transaction at the protocol level (`25P02`, "current transaction is
 * aborted") — catching the JS exception does not undo that, so a bare
 * `db.execute` here would poison the caller's transaction on the very 42P01
 * this function means to swallow, breaking every subsequent statement in it.
 * `DbOrTx.transaction()` avoids that politely: called on the top-level
 * `Database` it's a real `BEGIN`/`COMMIT`/`ROLLBACK`; called on an
 * already-open `Transaction` (drizzle's nested-transaction support) it's a
 * `SAVEPOINT`/`RELEASE SAVEPOINT`/`ROLLBACK TO SAVEPOINT` instead — either
 * way, a caught error here leaves the caller's connection in a clean, usable
 * state.
 */
export async function assertWritesAllowed(db: DbOrTx): Promise<void> {
  let active: boolean;
  try {
    active = await db.transaction(async (tx) => {
      const result = await tx.execute<{ active: boolean }>(sql`
        SELECT active FROM ${qualified(MAINTENANCE_SCHEMA, MAINTENANCE_TABLE)}
        WHERE id = true
      `);
      return result.rows[0]?.active ?? false;
    });
  } catch (err) {
    if (isUndefinedTableError(err)) return;
    throw err;
  }
  if (active) {
    throw new MaintenanceModeError();
  }
}

async function schemaExists(db: DbOrTx, schemaName: string): Promise<boolean> {
  const result = await db.execute<{ present: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schemaName}
    ) AS present
  `);
  return result.rows[0]?.present ?? false;
}

async function dropSchemaIfExists(
  db: DbOrTx,
  schemaName: string,
): Promise<void> {
  await db.execute(
    sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)} CASCADE`,
  );
}

/**
 * Wipes `public`'s tables and copies `snapshotSchema`'s rows back in,
 * FK-safe order (mirrors `restore-service.ts`'s own wipe+promote, kept as an
 * independent implementation here rather than imported so this module has no
 * dependency on `restore-service.ts`). Deliberately not wrapped in a single
 * transaction: this only ever runs from best-effort, run-once boot-time
 * recovery (`recoverInterruptedRestore`), and a partial failure here just
 * means a future `recoverInterruptedRestore` call can pick up where it left
 * off — the flag/snapshot stay in place until the whole recovery finishes.
 */
async function rollbackLiveFromSnapshot(
  db: DbOrTx,
  snapshotSchema: string,
): Promise<void> {
  for (const table of WIPE_TABLE_ORDER) {
    const name = getTableName(table);
    await db.execute(sql`DELETE FROM ${qualified("public", name)}`);
  }
  for (const table of EXPORT_TABLE_ORDER) {
    const name = getTableName(table);
    await db.execute(sql`
      INSERT INTO ${qualified("public", name)}
      SELECT * FROM ${qualified(snapshotSchema, name)}
    `);
  }
}

/**
 * Restores blobs from the newest `${uploadDir}${PRE_RESTORE_BLOB_DIR_INFIX}*`
 * sibling directory (the directory `restore-service.ts`'s `beginBlobSwap`
 * moves the pre-restore blob store aside to) back into `uploadDir`, mirroring
 * `restore-service.ts`'s own `undoBlobSwap`. If more than one such directory
 * exists (e.g. from more than one interrupted attempt), the newest by mtime
 * wins and every other one is discarded — they're stale artifacts of earlier
 * crashes, not independently recoverable state. A no-op if no such directory
 * exists (the crash happened before any pre-restore directory was created,
 * or blob promotion had already fully completed and cleaned up).
 */
async function restoreBlobsFromNewestPreRestoreDir(
  uploadDir: string,
): Promise<void> {
  const parentDir = dirname(uploadDir);
  const baseName = uploadDir.slice(parentDir.length + 1);
  const prefix = `${baseName}${PRE_RESTORE_BLOB_DIR_INFIX}`;

  let entries: Dirent[];
  try {
    entries = await readdir(parentDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => join(parentDir, entry.name));
  if (candidates.length === 0) return;

  const withMtimes = await Promise.all(
    candidates.map(async (path) => ({
      path,
      mtimeMs: (await stat(path)).mtimeMs,
    })),
  );
  withMtimes.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const [newest, ...stale] = withMtimes;
  if (!newest) return;

  await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
  if (await pathExists(newest.path)) {
    await rename(newest.path, uploadDir);
  }

  for (const { path } of stale) {
    await rm(path, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Drops every leftover `restore_staging_*`/`restore_snapshot_*` schema found
 * in the database — orphans from a restore that never reached its own
 * cleanup. Uses a regex match (not `LIKE`) so the prefixes' literal
 * underscores aren't treated as single-character wildcards.
 *
 * EXCLUDES whatever `restore_snapshot_*` schema is currently recorded by an
 * ACTIVE maintenance flag: that schema is a still-live recovery artifact (a
 * rollback that failed partway and deliberately left the flag active — see
 * `recoverInterruptedRestore`'s doc comment), not an orphan. Sweeping it out
 * from under a stuck recovery would make that half-completed rollback
 * unrecoverable.
 */
async function sweepLeftoverSchemas(db: DbOrTx): Promise<void> {
  const flag = await readMaintenanceFlag(db);
  const protectedSchema = flag.active ? flag.snapshotSchema : null;

  const result = await db.execute<{ nspname: string }>(sql`
    SELECT nspname FROM pg_catalog.pg_namespace
    WHERE nspname ~ '^restore_(staging|snapshot)_'
  `);
  for (const row of result.rows) {
    if (row.nspname === protectedSchema) continue;
    try {
      await dropSchemaIfExists(db, row.nspname);
    } catch (err) {
      logRecoveryFailure(`sweep leftover schema "${row.nspname}"`, err);
    }
  }
}

/** Removes every leftover `restore-staging-*` temp directory (siblings of `uploadDir`) — orphans from a restore whose own `finally` cleanup never ran. */
async function sweepLeftoverStagingDirs(uploadDir: string): Promise<void> {
  const parentDir = dirname(uploadDir);
  let entries: Dirent[];
  try {
    entries = await readdir(parentDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !entry.name.startsWith(STAGING_BLOB_DIR_PREFIX)
    ) {
      continue;
    }
    const path = join(parentDir, entry.name);
    try {
      await rm(path, { recursive: true, force: true });
    } catch (err) {
      logRecoveryFailure(`sweep leftover staging directory "${path}"`, err);
    }
  }
}

/**
 * Boot-time crash recovery for an interrupted restore (KTD5 fix): a process
 * that dies mid-promote (`restore-service.ts`'s `promote`, which now runs
 * for both the empty-instance and force-replace restore paths) can leave the
 * durable maintenance flag stuck active, its `restore_snapshot_*` schema
 * orphaned, the pre-restore blob directory never swapped back in, and
 * staging schemas/directories leaked. Called once from `instrumentation.ts`'s
 * `register()` on every server boot.
 *
 * Recovery contract: `active = true` together with a recorded
 * `snapshot_schema` that still exists in the database means the crash
 * happened inside (or after) the risky wipe+promote section — the DB is
 * rolled back from that snapshot and blobs are restored from the newest
 * pre-restore directory, then the snapshot is dropped. `active = true` with
 * no recorded snapshot (or one that no longer exists) means the crash
 * happened before the risky section began — nothing live was touched, so no
 * rollback is needed, and the flag is cleared immediately. Either way, once
 * recovery genuinely succeeds (or wasn't needed), the flag is cleared and a
 * general sweep removes any other leftover restore staging/snapshot schema
 * or temp directory regardless of what the flag says (they can only be
 * orphans by the time this runs — nothing should be actively restoring at
 * boot).
 *
 * **Partial-rollback failure.** `rollbackLiveFromSnapshot` is intentionally
 * NOT transactional (see its own doc comment) — if it dies partway through
 * its table-by-table loop, `public` may now be a genuine mix of wiped and
 * restored tables. In that case the maintenance flag is deliberately left
 * ACTIVE (not cleared) and the snapshot schema is deliberately preserved
 * (not dropped, and excluded from the general schema sweep below — see
 * {@link sweepLeftoverSchemas}) so `assertWritesAllowed` keeps blocking
 * ordinary writes against the half-wiped DB and a future
 * `recoverInterruptedRestore` call (or manual operator intervention) can
 * still retry from that same snapshot. The failure is logged loudly as
 * requiring manual intervention.
 *
 * Idempotent (safe to call multiple times, e.g. across restarts) and
 * defensive: every step is individually caught and logged, so a failure in
 * one step never prevents the rest from running and this function never
 * throws — a recovery failure must not crash server boot.
 */
export async function recoverInterruptedRestore(
  db: DbOrTx,
  uploadDir: string,
): Promise<void> {
  // Set when `rollbackLiveFromSnapshot` fails partway — see the doc comment
  // above. When true, the flag is deliberately left active below instead of
  // cleared, so recovery can be retried (or resolved manually) later.
  let rollbackFailed = false;

  try {
    const flag = await readMaintenanceFlag(db);
    if (flag.active && flag.snapshotSchema) {
      const snapshotSchema = flag.snapshotSchema;
      try {
        if (await schemaExists(db, snapshotSchema)) {
          await rollbackLiveFromSnapshot(db, snapshotSchema);
          try {
            await restoreBlobsFromNewestPreRestoreDir(uploadDir);
          } catch (err) {
            logRecoveryFailure("restore blobs from pre-restore directory", err);
          }
          await dropSchemaIfExists(db, snapshotSchema);
        }
      } catch (err) {
        rollbackFailed = true;
        console.error(
          `backup/maintenance: MANUAL INTERVENTION REQUIRED — rolling back an ` +
            `interrupted restore from snapshot "${snapshotSchema}" failed partway; ` +
            "the live database may now be a mix of wiped and restored tables. " +
            "The maintenance flag is being left ACTIVE (blocking ordinary writes) " +
            "and the snapshot schema is being preserved so a retry or manual " +
            "recovery can still use it.",
          err,
        );
      }
    }
  } catch (err) {
    logRecoveryFailure("read maintenance flag", err);
  } finally {
    if (!rollbackFailed) {
      try {
        await exitMaintenance(db);
      } catch (err) {
        logRecoveryFailure("clear maintenance flag", err);
      }
    }
  }

  try {
    await sweepLeftoverSchemas(db);
  } catch (err) {
    logRecoveryFailure("sweep leftover schemas", err);
  }
  try {
    await sweepLeftoverStagingDirs(uploadDir);
  } catch (err) {
    logRecoveryFailure("sweep leftover staging directories", err);
  }
}
