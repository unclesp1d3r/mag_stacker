import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { getTableName, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../../db/schema";
import { firearm, user } from "../../db/schema";
import { wipeDatabase } from "../db-import";
import {
  assertWritesAllowed,
  enterMaintenance,
  exitMaintenance,
  isMaintenanceActive,
  MaintenanceModeError,
  recordMaintenanceSnapshotSchema,
  recoverInterruptedRestore,
  SNAPSHOT_SCHEMA_PREFIX,
  STAGING_SCHEMA_PREFIX,
} from "../maintenance";
import { EXPORT_TABLE_ORDER } from "../table-order";

/**
 * Integration tests for the maintenance envelope's crash-recovery and
 * write-blocking primitives (KTD5 hardening). Every test runs against an
 * ephemeral Testcontainers Postgres (never the ambient dev DB) plus a
 * per-test temporary "UPLOAD_DIR" on the real filesystem, matching
 * `restore-service.test.ts`'s harness.
 */
const POSTGRES_IMAGE =
  "public.ecr.aws/docker/library/postgres:17@sha256:5c855ad7b85e68e48a62f34662853f38b57c1c1d80f3a927ab58034fd6d31c5e";

type Db = NodePgDatabase<typeof schema>;

function qualified(schemaName: string, name: string) {
  return sql`${sql.identifier(schemaName)}.${sql.identifier(name)}`;
}

async function snapshotTables(
  db: Db,
): Promise<Record<string, Record<string, unknown>[]>> {
  const snapshot: Record<string, Record<string, unknown>[]> = {};
  for (const table of EXPORT_TABLE_ORDER) {
    // biome-ignore lint/suspicious/noExplicitAny: EXPORT_TABLE_ORDER is deliberately heterogeneous.
    const rows = (await db.select().from(table as any)) as Record<
      string,
      unknown
    >[];
    snapshot[getTableName(table)] = rows.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return snapshot;
}

/** Seeds one user + one firearm under a fresh random owner; returns the owner label so callers can tell datasets apart. */
async function seedOwner(db: Db, label: string): Promise<string> {
  const ownerId = `owner-${randomUUID()}`;
  await db
    .insert(user)
    .values({ id: ownerId, name: label, email: `${ownerId}@example.test` });
  await db
    .insert(firearm)
    .values({ ownerId, name: `${label} FA`, caliber: "9mm" });
  return ownerId;
}

/** Mimics `restore-service.ts`'s `forcePromote` snapshot creation: a committed `CREATE TABLE ... AS TABLE` copy of every `public` table under a fresh schema. */
async function createSnapshotSchemaFromCurrentState(
  db: Db,
  snapshotSchema: string,
): Promise<void> {
  await db.execute(
    sql`DROP SCHEMA IF EXISTS ${sql.identifier(snapshotSchema)} CASCADE`,
  );
  await db.execute(sql`CREATE SCHEMA ${sql.identifier(snapshotSchema)}`);
  for (const table of EXPORT_TABLE_ORDER) {
    const name = getTableName(table);
    await db.execute(sql`
      CREATE TABLE ${qualified(snapshotSchema, name)}
      AS TABLE ${qualified("public", name)}
    `);
  }
}

async function schemaExists(db: Db, schemaName: string): Promise<boolean> {
  const result = await db.execute<{ present: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schemaName}
    ) AS present
  `);
  return result.rows[0]?.present ?? false;
}

async function listRestoreSchemas(db: Db): Promise<string[]> {
  const result = await db.execute<{ nspname: string }>(sql`
    SELECT nspname FROM pg_catalog.pg_namespace
    WHERE nspname ~ '^restore_(staging|snapshot)_'
    ORDER BY nspname
  `);
  return result.rows.map((r) => r.nspname);
}

async function readUploadDirKeys(uploadDir: string): Promise<string[]> {
  try {
    return (await readdir(uploadDir)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

describe("maintenance envelope (KTD5 hardening)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: Db;
  let uploadDir: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase("magstacker_maintenance_test")
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await wipeDatabase(db);
    await exitMaintenance(db);
    for (const schemaName of await listRestoreSchemas(db)) {
      await db
        .execute(
          sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)} CASCADE`,
        )
        .catch(() => {});
    }
    uploadDir = await mkdtemp(join(tmpdir(), "magstacker-maintenance-upload-"));
  });

  afterEach(async () => {
    const parentDir = join(uploadDir, "..");
    const entries = await readdir(parentDir).catch(() => [] as string[]);
    const uploadBase = uploadDir.slice(parentDir.length + 1);
    for (const entry of entries) {
      if (
        entry === uploadBase ||
        entry.startsWith(`${uploadBase}.pre-restore-`) ||
        entry.startsWith("restore-staging-")
      ) {
        await rm(join(parentDir, entry), {
          recursive: true,
          force: true,
        }).catch(() => {});
      }
    }
  });

  describe("assertWritesAllowed", () => {
    test("resolves without throwing when maintenance is not active", async () => {
      expect(await isMaintenanceActive(db)).toBe(false);
      await expect(assertWritesAllowed(db)).resolves.toBeUndefined();
    });

    test("throws MaintenanceModeError while maintenance is active", async () => {
      await enterMaintenance(db, "force-restore");

      let thrown: unknown;
      try {
        await assertWritesAllowed(db);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(MaintenanceModeError);
      expect((thrown as Error).message).toMatch(/maintenance/i);

      await exitMaintenance(db);
      await expect(assertWritesAllowed(db)).resolves.toBeUndefined();
    });

    test("fails open (resolves without throwing) when the maintenance infra has never been created — no restore has ever run", async () => {
      // `beforeEach` calls `exitMaintenance`, which (like every other
      // maintenance.ts function except `assertWritesAllowed`) ensures the
      // infra exists — drop it here to simulate a fresh instance that has
      // never entered maintenance, so `assertWritesAllowed`'s single SELECT
      // hits Postgres's 42P01 (undefined_table) and must fail open rather
      // than surface that as an error.
      await db.execute(
        sql`DROP SCHEMA IF EXISTS ${sql.identifier("restore_ops")} CASCADE`,
      );
      expect(await schemaExists(db, "restore_ops")).toBe(false);

      await expect(assertWritesAllowed(db)).resolves.toBeUndefined();
    });
  });

  describe("recoverInterruptedRestore", () => {
    test("is a no-op when maintenance was never active", async () => {
      await seedOwner(db, "Untouched Owner");
      const before = await snapshotTables(db);

      await recoverInterruptedRestore(db, uploadDir);

      expect(await snapshotTables(db)).toEqual(before);
      expect(await isMaintenanceActive(db)).toBe(false);
    });

    test("rolls back the DB from the recorded snapshot schema and clears the flag when a force-restore was interrupted mid-promote", async () => {
      // Simulate `forcePromote`'s sequence up to the crash point: the
      // pre-restore data is snapshotted, the flag records that snapshot,
      // then the wipe+promote transaction commits NEW data — and the
      // process "crashes" right there, before cleanup ever runs.
      await seedOwner(db, "Pre-Restore Owner");
      const expectedSnapshot = await snapshotTables(db);

      const snapshotSchema = `${SNAPSHOT_SCHEMA_PREFIX}${randomUUID().replace(/-/g, "")}`;
      await createSnapshotSchemaFromCurrentState(db, snapshotSchema);

      await wipeDatabase(db);
      await seedOwner(db, "Half-Promoted New Owner");

      await enterMaintenance(db, "force-restore");
      await recordMaintenanceSnapshotSchema(db, snapshotSchema);
      // No `exitMaintenance` call — this is the "crash before cleanup" state.

      expect(await isMaintenanceActive(db)).toBe(true);

      await recoverInterruptedRestore(db, uploadDir);

      expect(await snapshotTables(db)).toEqual(expectedSnapshot);
      expect(await isMaintenanceActive(db)).toBe(false);
      expect(await schemaExists(db, snapshotSchema)).toBe(false);
    });

    test("restores blobs from the newest pre-restore directory and discards stale ones during an interrupted-restore rollback", async () => {
      await seedOwner(db, "Pre-Restore Owner");
      const expectedSnapshot = await snapshotTables(db);
      const snapshotSchema = `${SNAPSHOT_SCHEMA_PREFIX}${randomUUID().replace(/-/g, "")}`;
      await createSnapshotSchemaFromCurrentState(db, snapshotSchema);
      await wipeDatabase(db);
      await seedOwner(db, "Half-Promoted New Owner");
      await enterMaintenance(db, "force-restore");
      await recordMaintenanceSnapshotSchema(db, snapshotSchema);

      // The pre-restore blob directory `beginBlobSwap` would have moved
      // aside — holds the ORIGINAL blobs, which is what recovery must
      // restore `uploadDir` back to.
      const staleDir = `${uploadDir}.pre-restore-${randomUUID()}`;
      await mkdir(staleDir, { recursive: true });
      await writeFile(
        join(staleDir, "stale.txt"),
        "stale — from an even older crash",
      );

      const originalDir = `${uploadDir}.pre-restore-${randomUUID()}`;
      await mkdir(originalDir, { recursive: true });
      await writeFile(
        join(originalDir, "original.txt"),
        "original pre-restore blob",
      );
      // The newest-by-mtime directory is the one that should win — force a
      // detectable ordering by writing the "original" (newest) dir last.

      // `uploadDir` itself holds whatever the half-finished force-restore
      // had already swapped in — new, half-promoted blobs.
      await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
      await mkdir(uploadDir, { recursive: true });
      await writeFile(join(uploadDir, "half-promoted.txt"), "new blob");

      await recoverInterruptedRestore(db, uploadDir);

      expect(await snapshotTables(db)).toEqual(expectedSnapshot);
      expect(await isMaintenanceActive(db)).toBe(false);

      const files = await readUploadDirKeys(uploadDir);
      expect(files).toEqual(["original.txt"]);
      const content = await readFile(join(uploadDir, "original.txt"), "utf8");
      expect(content).toBe("original pre-restore blob");

      // Both pre-restore directories (the newest one that was consumed, and
      // the stale older one) must be gone afterward — nothing left orphaned.
      const parentDir = join(uploadDir, "..");
      const remaining = await readdir(parentDir);
      expect(remaining.some((name) => name.includes(".pre-restore-"))).toBe(
        false,
      );
    });

    test("sweeps leftover restore_staging_*/restore_snapshot_* schemas and restore-staging-* temp directories regardless of flag state", async () => {
      const leftoverStagingSchema = `${STAGING_SCHEMA_PREFIX}${randomUUID().replace(/-/g, "")}`;
      const leftoverSnapshotSchema = `${SNAPSHOT_SCHEMA_PREFIX}${randomUUID().replace(/-/g, "")}`;
      await db.execute(
        sql`CREATE SCHEMA ${sql.identifier(leftoverStagingSchema)}`,
      );
      await db.execute(
        sql`CREATE SCHEMA ${sql.identifier(leftoverSnapshotSchema)}`,
      );

      const leftoverStagingDir = join(
        join(uploadDir, ".."),
        `restore-staging-${randomUUID()}`,
      );
      await mkdir(leftoverStagingDir, { recursive: true });
      await writeFile(join(leftoverStagingDir, "orphan.bin"), "orphan");

      expect(await isMaintenanceActive(db)).toBe(false);

      await recoverInterruptedRestore(db, uploadDir);

      expect(await schemaExists(db, leftoverStagingSchema)).toBe(false);
      expect(await schemaExists(db, leftoverSnapshotSchema)).toBe(false);
      expect(await listRestoreSchemas(db)).toEqual([]);

      const parentDir = join(uploadDir, "..");
      const remaining = await readdir(parentDir);
      expect(
        remaining.some((name) => name.startsWith("restore-staging-")),
      ).toBe(false);
    });

    test("clears the flag without touching data when maintenance was active but no snapshot was ever recorded (crash before the risky section began)", async () => {
      await seedOwner(db, "Untouched Owner");
      const before = await snapshotTables(db);

      await enterMaintenance(db, "restore");
      // Deliberately no `recordMaintenanceSnapshotSchema` call — this is the
      // "crash before the risky wipe+promote section ever began" state:
      // nothing live has been touched, so recovery must be a pure flag clear.
      expect(await isMaintenanceActive(db)).toBe(true);

      await recoverInterruptedRestore(db, uploadDir);

      expect(await snapshotTables(db)).toEqual(before);
      expect(await isMaintenanceActive(db)).toBe(false);
    });

    test("leaves the maintenance flag ACTIVE and preserves the snapshot schema when the snapshot rollback fails partway (manual intervention required)", async () => {
      await seedOwner(db, "Pre-Restore Owner");

      const snapshotSchema = `${SNAPSHOT_SCHEMA_PREFIX}${randomUUID().replace(/-/g, "")}`;
      // Deliberately incomplete snapshot: every table EXCEPT the last one in
      // `EXPORT_TABLE_ORDER`'s insert order is copied, so
      // `rollbackLiveFromSnapshot` successfully wipes+reinserts everything up
      // to that point, then dies mid-loop on the missing table — simulating
      // a crash partway through the non-transactional rollback.
      await db.execute(
        sql`DROP SCHEMA IF EXISTS ${sql.identifier(snapshotSchema)} CASCADE`,
      );
      await db.execute(sql`CREATE SCHEMA ${sql.identifier(snapshotSchema)}`);
      const tableNames = EXPORT_TABLE_ORDER.map((table) => getTableName(table));
      const skippedTable = tableNames[tableNames.length - 1];
      for (const table of EXPORT_TABLE_ORDER) {
        const name = getTableName(table);
        if (name === skippedTable) continue;
        await db.execute(sql`
          CREATE TABLE ${qualified(snapshotSchema, name)}
          AS TABLE ${qualified("public", name)}
        `);
      }

      await wipeDatabase(db);
      await seedOwner(db, "Half-Promoted New Owner");

      await enterMaintenance(db, "restore");
      await recordMaintenanceSnapshotSchema(db, snapshotSchema);

      await recoverInterruptedRestore(db, uploadDir);

      // The flag must NOT have been cleared — a half-rolled-back DB must
      // keep blocking ordinary writes until it's retried or resolved by
      // hand, per the "MANUAL INTERVENTION REQUIRED" contract.
      expect(await isMaintenanceActive(db)).toBe(true);
      // The snapshot must be preserved, not swept away — dropping it would
      // make the half-completed rollback unrecoverable.
      expect(await schemaExists(db, snapshotSchema)).toBe(true);

      await expect(assertWritesAllowed(db)).rejects.toBeInstanceOf(
        MaintenanceModeError,
      );

      // A subsequent sweep must also leave the still-referenced snapshot
      // alone — it's still the only way back, not an orphan.
      expect(await listRestoreSchemas(db)).toContain(snapshotSchema);
    });

    test("is idempotent — calling it twice in a row after a rollback is a harmless no-op", async () => {
      await seedOwner(db, "Pre-Restore Owner");
      const expectedSnapshot = await snapshotTables(db);
      const snapshotSchema = `${SNAPSHOT_SCHEMA_PREFIX}${randomUUID().replace(/-/g, "")}`;
      await createSnapshotSchemaFromCurrentState(db, snapshotSchema);
      await wipeDatabase(db);
      await seedOwner(db, "Half-Promoted New Owner");
      await enterMaintenance(db, "force-restore");
      await recordMaintenanceSnapshotSchema(db, snapshotSchema);

      await recoverInterruptedRestore(db, uploadDir);
      const afterFirst = await snapshotTables(db);
      expect(afterFirst).toEqual(expectedSnapshot);

      // Second call: flag is already clear and the snapshot schema is
      // already gone — must not throw, and must not change anything.
      await recoverInterruptedRestore(db, uploadDir);
      expect(await snapshotTables(db)).toEqual(afterFirst);
      expect(await isMaintenanceActive(db)).toBe(false);
    });
  });
});
