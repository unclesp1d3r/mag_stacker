/**
 * Restore service (plan Unit U5, R5-R10, KTD4/KTD5/KTD10/KTD11).
 *
 * The most safety-critical unit in the backup feature: `restore()` NEVER
 * touches live data until the entire uploaded bundle has authenticated
 * end-to-end (stage-then-promote, KTD10). Concretely:
 *
 * 1. Re-assert admin (defense-in-depth — the route also gates this).
 * 2. Decrypt the upload with `createDecryptStreamFromPassword` and drive
 *    `readBundle` over an isolated staging area: DB rows land in a Postgres
 *    `restore_staging` schema (via U3's `importDatabase`, redirected there
 *    with a `search_path` trick rather than a modified copy — U3 is
 *    consumed as-is); blobs land in a staging directory that `readBundle`
 *    itself path-validates (KTD11). A wrong password, a tampered byte
 *    ANYWHERE (including the last secretstream chunk), or a truncated
 *    stream throws before staging completes, or is only discovered once
 *    staging finishes (secretstream authenticates the final chunk at
 *    stream-end) — either way, nothing live has been touched yet.
 * 3. The manifest's `backupFormatVersion` is checked the moment it's read
 *    (the manifest is always the bundle's first entry), before any DB rows
 *    or blobs are staged (R8/AE4).
 * 4. Only once the whole bundle has authenticated does `restore()` check
 *    instance emptiness (R6/AE1) and, if empty (or `force`), promote staging
 *    to live.
 * 5. A `force` restore additionally runs the KTD5 envelope (`maintenance.ts`):
 *    durable maintenance flag, pool-safe advisory lock, a committed
 *    `restore_snapshot` schema of the pre-restore DB, and the pre-restore
 *    blob directory moved aside — so a failure at ANY point in the
 *    wipe+promote step (including after the DB side has already committed,
 *    but before the blob directory has been swapped in) rolls both stores
 *    back together.
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
import { createDecryptStreamFromPassword } from "./crypto";
import { importDatabase } from "./db-import";
import {
  enterMaintenance,
  exitMaintenance,
  withRestoreAdvisoryLock,
} from "./maintenance";
import { BACKUP_FORMAT_VERSION, type BackupManifest } from "./manifest";
import { EXPORT_TABLE_ORDER, WIPE_TABLE_ORDER } from "./table-order";

/** Postgres schema DB rows are staged into before the whole bundle authenticates (KTD10). Recreated fresh on every restore attempt. */
const STAGING_SCHEMA = "restore_staging";

/** Postgres schema a force-restore's pre-restore live data is copied into before the wipe (KTD5) — the DB-side rollback source if promote fails after committing. */
const SNAPSHOT_SCHEMA = "restore_snapshot";

/** Discriminated outcome of a restore attempt. Every branch carries an operator-facing `message`; none of them throw for expected restore-flow refusals — only a genuine programming/authorization error (see `restore`'s admin check) throws. */
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
  /** DI seam for tests — defaults to the shared singleton (`src/db/client.ts`). */
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

/**
 * Restore the whole instance from an encrypted backup bundle (F2/F3).
 * See the module doc comment for the full stage-then-promote sequence.
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

  await recreateStagingSchema(db);
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
      // before any row/blob is staged (R8/R6, AE4/AE1). Only once both pass
      // does stageBundle continue on to actually stage the bundle's rows and
      // blobs, so a full authentication check of the whole stream (including
      // a tamper in the final chunk, KTD10) only happens for restores that
      // could otherwise proceed.
      await stageBundle(decryptStream, stagingBlobDir, pool, {
        checkEmptiness: !force,
        instanceHasInventoryData: () => instanceHasInventoryData(db),
      });
    } catch (err) {
      if (err instanceof VersionMismatchSignal) {
        return { kind: "version_mismatch", message: err.message };
      }
      if (err instanceof NotEmptySignal) {
        return { kind: "refused_not_empty", message: err.message };
      }
      return {
        kind: "wrong_password_or_tampered",
        message: `bundle failed to authenticate: ${toError(err).message}`,
      };
    }

    try {
      if (force) {
        await forcePromote({
          db,
          pool,
          uploadDir,
          stagingBlobDir,
          testFaultInjection: options._testFaultInjection,
        });
      } else {
        await emptyInstancePromote({ db, uploadDir, stagingBlobDir });
      }
    } catch (err) {
      if (err instanceof RestoreRolledBackError) {
        return { kind: "rolled_back", message: err.message };
      }
      throw err;
    }

    return { kind: "ok", message: "restore completed successfully" };
  } finally {
    await db
      .execute(
        sql`DROP SCHEMA IF EXISTS ${sql.identifier(STAGING_SCHEMA)} CASCADE`,
      )
      .catch(() => {});
    await rm(stagingBlobDir, { recursive: true, force: true }).catch(() => {});
  }
}

class VersionMismatchSignal extends Error {}
class NotEmptySignal extends Error {}

/** (Re)creates an empty `restore_staging` schema with one table per `EXPORT_TABLE_ORDER` entry, structurally mirroring `public` (KTD10 staging area). */
async function recreateStagingSchema(db: Database): Promise<void> {
  await db.execute(
    sql`DROP SCHEMA IF EXISTS ${sql.identifier(STAGING_SCHEMA)} CASCADE`,
  );
  await db.execute(sql`CREATE SCHEMA ${sql.identifier(STAGING_SCHEMA)}`);
  for (const table of EXPORT_TABLE_ORDER) {
    const name = getTableName(table);
    await db.execute(sql`
      CREATE TABLE ${qualified(STAGING_SCHEMA, name)}
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
      await importIntoStaging(pool, event.stream);
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
 * redirected to `restore_staging` first, so `importDatabase`'s unqualified
 * `INSERT INTO "tablename"` statements land there instead of `public`.
 */
async function importIntoStaging(
  pool: Pool,
  dbStream: Readable,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${STAGING_SCHEMA}", public`);
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
 * promote staging rows into live in one transaction. Either step failing
 * undoes the other — no live change survives a partial failure.
 */
async function emptyInstancePromote(ctx: {
  db: Database;
  uploadDir: string;
  stagingBlobDir: string;
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
      await copySchemaToLive(tx, STAGING_SCHEMA);
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
 * F3 (force-replace) promote — the KTD5 envelope: maintenance flag, pool-safe
 * advisory lock, a committed pre-restore snapshot schema, wipe+promote in one
 * transaction, and a blob-directory swap. A failure anywhere after the
 * snapshot is committed rolls BOTH the DB (restored from the snapshot, if the
 * wipe+promote transaction had already committed) and the blobs (restored
 * from the moved-aside directory) back together, then always exits
 * maintenance.
 */
async function forcePromote(ctx: {
  db: Database;
  pool: Pool;
  uploadDir: string;
  stagingBlobDir: string;
  testFaultInjection?: RestoreOptions["_testFaultInjection"];
}): Promise<void> {
  await enterMaintenance(ctx.db, "force-restore");
  try {
    await withRestoreAdvisoryLock(ctx.pool, async (client) => {
      const opsDb = drizzle(client, { schema });

      await opsDb.execute(
        sql`DROP SCHEMA IF EXISTS ${sql.identifier(SNAPSHOT_SCHEMA)} CASCADE`,
      );
      await opsDb.execute(
        sql`CREATE SCHEMA ${sql.identifier(SNAPSHOT_SCHEMA)}`,
      );
      for (const table of EXPORT_TABLE_ORDER) {
        const name = getTableName(table);
        await opsDb.execute(sql`
          CREATE TABLE ${qualified(SNAPSHOT_SCHEMA, name)}
          AS TABLE ${qualified("public", name)}
        `);
      }

      const swap = await beginBlobSwap(ctx.uploadDir);

      let dbCommitted = false;
      try {
        await opsDb.transaction(async (tx) => {
          await wipeLive(tx);
          await copySchemaToLive(tx, STAGING_SCHEMA);
          await ctx.testFaultInjection?.("pre-commit");
        });
        dbCommitted = true;

        await ctx.testFaultInjection?.("post-commit-pre-blob-swap");
        await finishBlobSwap(ctx.stagingBlobDir, ctx.uploadDir);
      } catch (err) {
        if (dbCommitted) {
          // The wipe+promote transaction already committed new data — the
          // only way back is to explicitly restore from the snapshot.
          await opsDb.transaction(async (tx) => {
            await wipeLive(tx);
            await copySchemaToLive(tx, SNAPSHOT_SCHEMA);
          });
        }
        await undoBlobSwap(swap, ctx.uploadDir);
        await opsDb
          .execute(
            sql`DROP SCHEMA IF EXISTS ${sql.identifier(SNAPSHOT_SCHEMA)} CASCADE`,
          )
          .catch(() => {});
        throw new RestoreRolledBackError(
          `force-restore promotion failed and was rolled back: ${toError(err).message}`,
          { cause: err },
        );
      }

      await opsDb.execute(
        sql`DROP SCHEMA IF EXISTS ${sql.identifier(SNAPSHOT_SCHEMA)} CASCADE`,
      );
      await commitBlobSwap(swap);
    });
  } finally {
    await exitMaintenance(ctx.db);
  }
}
