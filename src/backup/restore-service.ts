/**
 * Restore service (plan Unit U5, R5-R10, KTD4/KTD5/KTD10/KTD11).
 *
 * The most safety-critical unit in the backup feature: `restore()` NEVER
 * touches live data until the entire uploaded bundle has authenticated
 * end-to-end (stage-then-promote, KTD10). Concretely:
 *
 * 1. Re-assert admin (defense-in-depth — the route also gates this).
 * 2. Decrypt the upload with `createDecryptStreamFromPassword` and drive
 *    `readBundle` over an isolated staging area: DB rows land in a per-run
 *    Postgres `restore_staging_<runId>` schema (via U3's `importDatabase`,
 *    redirected there with a `search_path` trick rather than a modified copy
 *    — U3 is consumed as-is); blobs land in a staging directory that
 *    `readBundle` itself path-validates (KTD11). A wrong password, a
 *    tampered byte ANYWHERE (including the last secretstream chunk), or a
 *    truncated stream throws before staging completes, or is only
 *    discovered once staging finishes (secretstream authenticates the final
 *    chunk at stream-end) — either way, nothing live has been touched yet.
 * 3. The manifest's `backupFormatVersion` is checked the moment it's read
 *    (the manifest is always the bundle's first entry), before any DB rows
 *    or blobs are staged (R8/AE4).
 * 4. Only once the whole bundle has authenticated does `restore()` check
 *    instance emptiness (R6/AE1) and, if empty (or `force`), promote staging
 *    to live.
 * 5. A `force` restore additionally runs the KTD5 envelope (`maintenance.ts`):
 *    durable maintenance flag, a committed `restore_snapshot_<runId>` schema
 *    of the pre-restore DB, and the pre-restore blob directory moved aside —
 *    so a failure at ANY point in the wipe+promote step (including after the
 *    DB side has already committed, but before the blob directory has been
 *    swapped in) rolls both stores back together.
 *
 * **Concurrency (KTD5 hardening).** Every per-run schema (`restore_staging_*`
 * and, for `force`, `restore_snapshot_*`) is named with a fresh random suffix
 * per call, so two overlapping restores never collide on schema names. That
 * alone isn't enough to prevent corruption, though: both restores still
 * write to the shared `public` schema during promote, and interleaved
 * wipe+promote transactions from two different restores could each commit
 * different tables' worth of data, leaving `public` a genuine mix of both
 * bundles. `restore()` therefore holds `withRestoreAdvisoryLock` for its
 * ENTIRE body — staging through promote, both the empty-instance and force
 * paths — so only one restore attempt is ever inside the risky section at a
 * time; a second concurrent call blocks until the first fully finishes
 * (commit or rollback) before it even begins staging.
 */

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable, Transform } from "node:stream";
import { count, getTableName, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { NotAuthorizedError } from "@/src/auth/errors";
import { isAdmin } from "@/src/auth/session";
import {
  type Database,
  db as defaultDb,
  pool as defaultPool,
  type Transaction,
} from "@/src/db/client";
import * as schema from "@/src/db/schema";
import { accessory, ammo, firearm, magazine } from "@/src/db/schema";
import { activeStorageRoot } from "@/src/storage";
import { readBundle } from "./bundle";
import {
  createDecryptStreamFromPassword,
  DecryptionAuthError,
  InvalidHeaderError,
} from "./crypto";
import { importDatabase } from "./db-import";
import {
  enterMaintenance,
  exitMaintenance,
  recordMaintenanceSnapshotSchema,
  SNAPSHOT_SCHEMA_PREFIX,
  STAGING_SCHEMA_PREFIX,
  withRestoreAdvisoryLock,
} from "./maintenance";
import { BACKUP_FORMAT_VERSION, type BackupManifest } from "./manifest";
import { EXPORT_TABLE_ORDER, WIPE_TABLE_ORDER } from "./table-order";

/** Discriminated outcome of a restore attempt. Every branch carries an operator-facing `message`; none of them throw for expected restore-flow refusals — only a genuine programming/authorization error (see `restore`'s admin check) or an unclassified staging failure (see the module doc comment on error classification) throws. */
export type RestoreOutcome =
  | { readonly kind: "ok"; readonly message: string }
  | { readonly kind: "refused_not_empty"; readonly message: string }
  | { readonly kind: "wrong_password_or_tampered"; readonly message: string }
  | { readonly kind: "version_mismatch"; readonly message: string }
  | { readonly kind: "rolled_back"; readonly message: string };

/** Thrown internally when a force-restore's promote step fails after entering the risky section; `restore()` converts this into a `'rolled_back'` outcome. Not exported — callers observe it only via `RestoreOutcome`. */
class RestoreRolledBackError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RestoreRolledBackError";
  }
}

export interface RestoreOptions {
  /** Force-replace an already-populated instance (R7/F3). Defaults to false (refuse-unless-empty, R6/F2). */
  readonly force?: boolean;
  /** DI seam for tests — defaults to the shared singleton (`src/db/client.ts`). Used for reads (the emptiness check) that don't need to run on the locked connection; every schema-level write runs on a connection bound to `withRestoreAdvisoryLock`'s checked-out client instead (see the module doc comment). */
  readonly db?: Database;
  /** DI seam for tests — defaults to the shared singleton pool (`src/db/client.ts`). Must be the same pool `db` is bound to. */
  readonly pool?: Pool;
  /** DI seam for tests — defaults to the shared storage root (`src/storage`). */
  readonly uploadDir?: string;
  /** DI seam for tests — defaults to the real session-backed `isAdmin()`, which requires a Next.js request context `restore()` won't have outside a route/action. */
  readonly checkIsAdmin?: () => Promise<boolean>;
  /**
   * Test-only fault-injection hook for the force-restore promote envelope.
   * Never supplied in production. See `restore-service.test.ts`'s
   * fault-injection tests for both trip points this can throw from: still
   * inside the wipe+promote transaction (before it commits) and after it has
   * committed but before the blob directory has been swapped in — the two
   * distinct failure windows KTD5's snapshot exists to cover.
   */
  readonly _testFaultInjection?: (
    point: "pre-commit" | "post-commit-pre-blob-swap",
  ) => void | Promise<void>;
}

function qualified(schemaName: string, name: string) {
  return sql`${sql.identifier(schemaName)}.${sql.identifier(name)}`;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
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

/** Generates a fresh per-run hex id so two overlapping restore attempts never share a staging/snapshot schema name. */
function generateRunId(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * Restore the whole instance from an encrypted backup bundle (F2/F3).
 * See the module doc comment for the full stage-then-promote sequence and
 * the concurrency contract (the whole body runs under the restore advisory
 * lock, keyed by a fresh per-run schema suffix).
 */
export async function restore(
  stream: Readable,
  password: string,
  options: RestoreOptions = {},
): Promise<RestoreOutcome> {
  const checkIsAdmin = options.checkIsAdmin ?? isAdmin;
  if (!(await checkIsAdmin())) {
    // Not a modeled RestoreOutcome: an unauthorized caller is a programming/
    // authorization error, not a legitimate restore-flow branch (R14,
    // defense-in-depth — the route is expected to have already gated this).
    throw new NotAuthorizedError("only an admin may restore a backup");
  }

  const db = options.db ?? defaultDb;
  const pool = options.pool ?? defaultPool;
  const uploadDir = options.uploadDir ?? activeStorageRoot();
  const force = options.force ?? false;

  const runId = generateRunId();
  const stagingSchema = `${STAGING_SCHEMA_PREFIX}${runId}`;
  const snapshotSchema = `${SNAPSHOT_SCHEMA_PREFIX}${runId}`;

  // The ENTIRE staging+promote body runs under one advisory lock, held on a
  // single dedicated connection (`opsDb`) for the whole call — see the
  // module doc comment. `forcePromote`/`emptyInstancePromote` therefore MUST
  // NOT acquire this lock themselves (it isn't reentrant across connections;
  // doing so would deadlock this very call).
  return await withRestoreAdvisoryLock(pool, async (client) => {
    const opsDb = drizzle(client, { schema });

    await recreateStagingSchema(opsDb, stagingSchema);
    const stagingBlobDir = await mkdtemp(
      join(dirname(uploadDir), "restore-staging-"),
    );

    try {
      const decryptStream = createDecryptStreamFromPassword(password);
      stream.on("error", (err) => decryptStream.destroy(err));
      stream.pipe(decryptStream);

      try {
        // Version and emptiness are both checked inside stageBundle, the
        // moment the manifest (always the bundle's first entry) is read —
        // before any row/blob is staged (R8/R6, AE4/AE1). Only once both
        // pass does stageBundle continue on to actually stage the bundle's
        // rows and blobs, so a full authentication check of the whole
        // stream (including a tamper in the final chunk, KTD10) only
        // happens for restores that could otherwise proceed.
        await stageBundle(
          decryptStream,
          stagingBlobDir,
          pool,
          {
            checkEmptiness: !force,
            instanceHasInventoryData: () => instanceHasInventoryData(db),
          },
          stagingSchema,
        );
      } catch (err) {
        if (err instanceof VersionMismatchSignal) {
          return { kind: "version_mismatch", message: err.message };
        }
        if (err instanceof NotEmptySignal) {
          return { kind: "refused_not_empty", message: err.message };
        }
        // Only a genuine cryptographic authentication failure means "wrong
        // password or a tampered bundle" — every other staging failure
        // (ENOSPC, a malformed tar, an unknown table in the NDJSON export,
        // a path-traversal blob entry, ...) is a distinct, unrelated
        // problem and must not be misreported as a password/tamper issue.
        // Re-throwing here lets the route's own catch-all surface its
        // generic "restore failed unexpectedly" outcome instead.
        if (
          err instanceof DecryptionAuthError ||
          err instanceof InvalidHeaderError
        ) {
          return {
            kind: "wrong_password_or_tampered",
            message: `bundle failed to authenticate: ${toError(err).message}`,
          };
        }
        throw err;
      }

      try {
        if (force) {
          await forcePromote({
            db: opsDb,
            uploadDir,
            stagingBlobDir,
            stagingSchema,
            snapshotSchema,
            testFaultInjection: options._testFaultInjection,
          });
        } else {
          await emptyInstancePromote({
            db: opsDb,
            uploadDir,
            stagingBlobDir,
            stagingSchema,
          });
        }
      } catch (err) {
        if (err instanceof RestoreRolledBackError) {
          return { kind: "rolled_back", message: err.message };
        }
        throw err;
      }

      return { kind: "ok", message: "restore completed successfully" };
    } finally {
      await opsDb
        .execute(
          sql`DROP SCHEMA IF EXISTS ${sql.identifier(stagingSchema)} CASCADE`,
        )
        .catch(() => {});
      await rm(stagingBlobDir, { recursive: true, force: true }).catch(
        () => {},
      );
    }
  });
}

class VersionMismatchSignal extends Error {}
class NotEmptySignal extends Error {}

/** (Re)creates an empty per-run staging schema with one table per `EXPORT_TABLE_ORDER` entry, structurally mirroring `public` (KTD10 staging area). */
async function recreateStagingSchema(
  db: Database,
  stagingSchema: string,
): Promise<void> {
  await db.execute(
    sql`DROP SCHEMA IF EXISTS ${sql.identifier(stagingSchema)} CASCADE`,
  );
  await db.execute(sql`CREATE SCHEMA ${sql.identifier(stagingSchema)}`);
  for (const table of EXPORT_TABLE_ORDER) {
    const name = getTableName(table);
    await db.execute(sql`
      CREATE TABLE ${qualified(stagingSchema, name)}
      (LIKE ${qualified("public", name)} INCLUDING ALL)
    `);
  }
}

interface StageBundleOptions {
  /** Whether to refuse a non-empty instance (skipped for `force`). */
  readonly checkEmptiness: boolean;
  readonly instanceHasInventoryData: () => Promise<boolean>;
}

/**
 * Drives `readBundle` to completion: checks the manifest's
 * `backupFormatVersion` and (unless `force`) instance emptiness the moment
 * the manifest is read — the bundle's always-first entry — refusing BEFORE
 * any row/blob is staged (R8/R6, AE4/AE1). Only once both checks pass does it
 * import the `db.ndjson` stream into the staging schema and let `readBundle`
 * itself stage every blob (KTD11 path validation lives there). Only returns
 * once the underlying decrypt stream has authenticated the WHOLE bundle,
 * including its final secretstream chunk (KTD10) — a tamper anywhere,
 * including the last chunk, surfaces as a thrown `DecryptionAuthError` here
 * instead.
 */
async function stageBundle(
  decryptStream: Transform,
  stagingBlobDir: string,
  pool: Pool,
  options: StageBundleOptions,
  stagingSchema: string,
): Promise<{ manifest: BackupManifest }> {
  const generator = readBundle(decryptStream, { stagingDir: stagingBlobDir });

  let manifest: BackupManifest | undefined;
  for await (const event of generator) {
    if (event.kind === "manifest") {
      manifest = event.manifest;
      if (manifest.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
        throw new VersionMismatchSignal(
          `bundle backupFormatVersion ${manifest.backupFormatVersion} is incompatible with this instance's ${BACKUP_FORMAT_VERSION}`,
        );
      }
      if (
        options.checkEmptiness &&
        (await options.instanceHasInventoryData())
      ) {
        throw new NotEmptySignal(
          "the instance already holds inventory data; use force-replace to overwrite it",
        );
      }
    } else if (event.kind === "db") {
      await importIntoStaging(pool, event.stream, stagingSchema);
    }
    // "blob" events: readBundle has already written + path-validated the
    // file under stagingBlobDir (KTD11) — nothing further to do here.
  }

  if (!manifest) {
    throw new Error("internal: readBundle completed without a manifest event");
  }
  return { manifest };
}

/**
 * Imports `dbStream` into the staging schema by reusing U3's
 * `importDatabase` UNMODIFIED: a dedicated connection has its `search_path`
 * redirected to `stagingSchema` first, so `importDatabase`'s unqualified
 * `INSERT INTO "tablename"` statements land there instead of `public`. This
 * deliberately uses its own `pool.connect()`-checked-out connection rather
 * than the outer restore's locked connection — the two don't need to share a
 * connection (the advisory lock already serializes concurrent restore
 * attempts at the JS level), and isolating the `search_path` change here
 * keeps it from leaking onto any other connection.
 */
async function importIntoStaging(
  pool: Pool,
  dbStream: Readable,
  stagingSchema: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${stagingSchema}", public`);
    const stagingDb = drizzle(client, { schema });
    await importDatabase(stagingDb, dbStream);
  } finally {
    await client.query("RESET search_path").catch(() => {});
    client.release();
  }
}

/** True when the instance already holds owned inventory data (R6's "instance already holds inventory data"). Auth tables (user/verification/account) are deliberately excluded — an admin must already exist to reach restore at all, so a live user row alone doesn't mean "non-empty" for this purpose. */
async function instanceHasInventoryData(db: Database): Promise<boolean> {
  const [firearmCount, magazineCount, ammoCount, accessoryCount] =
    await Promise.all([
      db.select({ n: count() }).from(firearm),
      db.select({ n: count() }).from(magazine),
      db.select({ n: count() }).from(ammo),
      db.select({ n: count() }).from(accessory),
    ]);
  return [firearmCount, magazineCount, ammoCount, accessoryCount].some(
    (rows) => (rows[0]?.n ?? 0) > 0,
  );
}

interface BlobSwapHandle {
  readonly hadExistingDir: boolean;
  readonly movedAsideDir: string;
}

/** Moves `uploadDir` aside (if present) so the staged blob directory can take its place. Reversible via `undoBlobSwap`/`commitBlobSwap`. */
async function beginBlobSwap(uploadDir: string): Promise<BlobSwapHandle> {
  const movedAsideDir = `${uploadDir}.pre-restore-${randomUUID()}`;
  const hadExistingDir = await pathExists(uploadDir);
  if (hadExistingDir) {
    await rename(uploadDir, movedAsideDir);
  }
  return { hadExistingDir, movedAsideDir };
}

/** Swaps the staged blob directory into `uploadDir`'s now-vacated path. */
async function finishBlobSwap(
  stagingBlobDir: string,
  uploadDir: string,
): Promise<void> {
  await rename(stagingBlobDir, uploadDir);
}

/** Undoes `beginBlobSwap` (and any partial `finishBlobSwap`): removes whatever now sits at `uploadDir` and restores the original contents. */
async function undoBlobSwap(
  handle: BlobSwapHandle,
  uploadDir: string,
): Promise<void> {
  await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
  if (handle.hadExistingDir) {
    await rename(handle.movedAsideDir, uploadDir).catch(() => {});
  } else {
    await mkdir(uploadDir, { recursive: true, mode: 0o700 }).catch(() => {});
  }
}

/** Discards the moved-aside pre-restore blobs after a successful promote. */
async function commitBlobSwap(handle: BlobSwapHandle): Promise<void> {
  if (handle.hadExistingDir) {
    await rm(handle.movedAsideDir, { recursive: true, force: true }).catch(
      () => {},
    );
  }
}

async function copySchemaToLive(
  tx: Transaction,
  fromSchema: string,
): Promise<void> {
  for (const table of EXPORT_TABLE_ORDER) {
    const name = getTableName(table);
    await tx.execute(sql`
      INSERT INTO ${qualified("public", name)}
      SELECT * FROM ${qualified(fromSchema, name)}
    `);
  }
}

async function wipeLive(tx: Transaction): Promise<void> {
  for (const table of WIPE_TABLE_ORDER) {
    const name = getTableName(table);
    await tx.execute(sql`DELETE FROM ${qualified("public", name)}`);
  }
}

/**
 * F2 (empty instance) promote: swap the staged blob directory in, then
 * wipe-and-promote staging rows into live in one transaction. Either step
 * failing undoes the other — no live change survives a partial failure.
 *
 * "Empty" here means no *inventory* data (`instanceHasInventoryData`); the
 * instance can still hold bootstrap auth rows (the admin who is performing the
 * restore always exists in `public.user`). Those must be replaced, not merged
 * into — a plain `INSERT` of the backup's users would collide with the live
 * admin on `user.email`'s UNIQUE constraint and roll the whole restore back.
 * So this wipes live tables before copying, exactly like force-replace, and
 * relies on the single wrapping transaction for atomic DB rollback (no
 * separate snapshot schema is needed: a failed transaction reverts the wipe
 * too, and the blob swap happened first and is undone on failure).
 *
 * `ctx.db` is bound to the SAME locked connection `restore()` holds for its
 * entire body (see the module doc comment) — this doesn't need its own
 * advisory lock.
 */
async function emptyInstancePromote(ctx: {
  db: Database;
  uploadDir: string;
  stagingBlobDir: string;
  stagingSchema: string;
}): Promise<void> {
  const swap = await beginBlobSwap(ctx.uploadDir);
  try {
    await finishBlobSwap(ctx.stagingBlobDir, ctx.uploadDir);
  } catch (err) {
    await undoBlobSwap(swap, ctx.uploadDir);
    throw new RestoreRolledBackError(
      `blob promotion failed: ${toError(err).message}`,
      { cause: err },
    );
  }

  try {
    await ctx.db.transaction(async (tx) => {
      await wipeLive(tx);
      await copySchemaToLive(tx, ctx.stagingSchema);
    });
  } catch (err) {
    await undoBlobSwap(swap, ctx.uploadDir);
    throw new RestoreRolledBackError(
      `database promotion failed: ${toError(err).message}`,
      { cause: err },
    );
  }

  await commitBlobSwap(swap);
}

/**
 * F3 (force-replace) promote — the KTD5 envelope: durable maintenance flag,
 * a committed pre-restore snapshot schema, wipe+promote in one transaction,
 * and a blob-directory swap. A failure anywhere after the snapshot is
 * committed rolls BOTH the DB (restored from the snapshot, if the
 * wipe+promote transaction had already committed) and the blobs (restored
 * from the moved-aside directory) back together, then always exits
 * maintenance.
 *
 * `ctx.db` is bound to the SAME locked connection `restore()` holds for its
 * entire body (see the module doc comment) — this function does NOT acquire
 * its own advisory lock (doing so would deadlock: a second
 * `pg_advisory_lock` call for the same key on a different connection blocks
 * until the first is released, and the first is this very call).
 */
async function forcePromote(ctx: {
  db: Database;
  uploadDir: string;
  stagingBlobDir: string;
  stagingSchema: string;
  snapshotSchema: string;
  testFaultInjection?: RestoreOptions["_testFaultInjection"];
}): Promise<void> {
  await enterMaintenance(ctx.db, "force-restore");
  try {
    await ctx.db.execute(
      sql`DROP SCHEMA IF EXISTS ${sql.identifier(ctx.snapshotSchema)} CASCADE`,
    );
    await ctx.db.execute(
      sql`CREATE SCHEMA ${sql.identifier(ctx.snapshotSchema)}`,
    );
    for (const table of EXPORT_TABLE_ORDER) {
      const name = getTableName(table);
      await ctx.db.execute(sql`
        CREATE TABLE ${qualified(ctx.snapshotSchema, name)}
        AS TABLE ${qualified("public", name)}
      `);
    }
    // Only recorded once the snapshot schema is fully built and committed —
    // this is the durable signal `recoverInterruptedRestore` uses to decide
    // a crash happened during (or after) the risky section, not before it.
    await recordMaintenanceSnapshotSchema(ctx.db, ctx.snapshotSchema);

    const swap = await beginBlobSwap(ctx.uploadDir);

    let dbCommitted = false;
    try {
      await ctx.db.transaction(async (tx) => {
        await wipeLive(tx);
        await copySchemaToLive(tx, ctx.stagingSchema);
        await ctx.testFaultInjection?.("pre-commit");
      });
      dbCommitted = true;

      await ctx.testFaultInjection?.("post-commit-pre-blob-swap");
      await finishBlobSwap(ctx.stagingBlobDir, ctx.uploadDir);
    } catch (err) {
      if (dbCommitted) {
        // The wipe+promote transaction already committed new data — the
        // only way back is to explicitly restore from the snapshot.
        await ctx.db.transaction(async (tx) => {
          await wipeLive(tx);
          await copySchemaToLive(tx, ctx.snapshotSchema);
        });
      }
      await undoBlobSwap(swap, ctx.uploadDir);
      await ctx.db
        .execute(
          sql`DROP SCHEMA IF EXISTS ${sql.identifier(ctx.snapshotSchema)} CASCADE`,
        )
        .catch(() => {});
      throw new RestoreRolledBackError(
        `force-restore promotion failed and was rolled back: ${toError(err).message}`,
        { cause: err },
      );
    }

    await ctx.db.execute(
      sql`DROP SCHEMA IF EXISTS ${sql.identifier(ctx.snapshotSchema)} CASCADE`,
    );
    await commitBlobSwap(swap);
  } finally {
    await exitMaintenance(ctx.db);
  }
}
