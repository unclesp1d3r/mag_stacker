import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { getTableName, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../../db/schema";
import {
  accessory,
  account,
  ammo,
  firearm,
  firearmDocument,
  firearmPhoto,
  grant,
  inventoryLog,
  magazine,
  magazineFirearm,
  magazineLabelPrefix,
  operatorAudit,
  rangeSession,
  rangeSessionAccessory,
  rateLimit,
  session,
  user,
  verification,
} from "../../db/schema";
import { type ExportedRow, exportDatabase } from "../db-export";
import {
  importDatabase,
  MAX_NDJSON_LINE_BYTES,
  wipeDatabase,
} from "../db-import";
import { EPHEMERAL_TABLE_NAMES, EXPORT_TABLE_ORDER } from "../table-order";

/**
 * Round-trip integration test for the NDJSON export/import pair (U3). Runs
 * against an ephemeral Testcontainers Postgres — NOT the ambient dev
 * database — because these tests wipe every table, which would be
 * destructive against a shared/ambient DB.
 *
 * Same pinned image as `e2e/start-test-server.ts` (AWS ECR Public mirror —
 * avoids Docker Hub's unauthenticated per-IP pull limit on shared runners).
 */
const POSTGRES_IMAGE =
  "public.ecr.aws/docker/library/postgres:17@sha256:5c855ad7b85e68e48a62f34662853f38b57c1c1d80f3a927ab58034fd6d31c5e";

type Db = NodePgDatabase<typeof schema>;

interface SeededInventory {
  ownerId: string;
  granteeId: string;
  firearmId: string;
  documentId: string;
}

/**
 * Seed one of every non-ephemeral row type the export must cover, plus a
 * `session` and `rate_limit` row (ephemeral — must NOT survive into the
 * export). Mirrors `src/test-support/factories.ts`'s shapes but is
 * parameterized on a locally-constructed `db` bound to the test container,
 * rather than the process-wide singleton in `src/db/client.ts`.
 */
async function seedFullInventory(db: Db): Promise<SeededInventory> {
  const ownerId = `owner-${randomUUID()}`;
  const granteeId = `grantee-${randomUUID()}`;

  await db.insert(user).values([
    { id: ownerId, name: "Owner", email: `${ownerId}@example.test` },
    { id: granteeId, name: "Grantee", email: `${granteeId}@example.test` },
  ]);

  await db.insert(verification).values({
    id: randomUUID(),
    identifier: `verify-${ownerId}`,
    value: "token",
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  await db.insert(account).values({
    id: randomUUID(),
    accountId: ownerId,
    providerId: "credential",
    userId: ownerId,
    password: "hashed",
  });

  const [firearmRow] = await db
    .insert(firearm)
    .values({ ownerId, name: "Round Trip FA", caliber: "9mm", isNfa: true })
    .returning();

  const [magazineRow] = await db
    .insert(magazine)
    .values({
      ownerId,
      brandModel: "Round Trip MG",
      caliber: "9mm",
      baseCapacity: 17,
    })
    .returning();

  await db
    .insert(ammo)
    .values({ ownerId, caliber: "9mm", brand: "Round Trip Ammo Co" });

  const [accessoryRow] = await db
    .insert(accessory)
    .values({ ownerId, category: "optic", currentFirearmId: firearmRow.id })
    .returning();

  await db.insert(magazineLabelPrefix).values({ ownerId, prefix: "RT" });

  await db.insert(magazineFirearm).values({
    magazineId: magazineRow.id,
    firearmId: firearmRow.id,
    ordinal: 0,
  });

  const [rangeSessionRow] = await db
    .insert(rangeSession)
    .values({ firearmId: firearmRow.id, date: "2026-01-01", roundsFired: 50 })
    .returning();

  await db.insert(rangeSessionAccessory).values({
    rangeSessionId: rangeSessionRow.id,
    accessoryId: accessoryRow.id,
  });

  await db.insert(firearmPhoto).values({
    firearmId: firearmRow.id,
    storageKey: `${randomUUID()}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    width: 800,
    height: 600,
    sortOrder: 0,
  });

  const [documentRow] = await db
    .insert(firearmDocument)
    .values({
      firearmId: firearmRow.id,
      storageKey: `${randomUUID()}.pdf`,
      filename: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      docType: "receipt",
    })
    .returning();

  await db.insert(grant).values({
    ownerId,
    granteeId,
    parentType: "firearm",
    parentId: firearmRow.id,
    permission: "view",
  });

  await db.insert(inventoryLog).values({
    parentType: "firearm",
    parentId: firearmRow.id,
    eventType: "inventoried",
    actorId: ownerId,
  });

  await db.insert(operatorAudit).values({
    actor: ownerId,
    action: "export",
    outcome: "success",
  });

  // Ephemeral rows — must never appear in an export.
  await db.insert(session).values({
    id: randomUUID(),
    expiresAt: new Date(Date.now() + 3_600_000),
    token: randomUUID(),
    userId: ownerId,
  });
  await db.insert(rateLimit).values({
    id: randomUUID(),
    key: `rl-${randomUUID()}`,
    count: 1,
    lastRequest: Date.now(),
  });

  return {
    ownerId,
    granteeId,
    firearmId: firearmRow.id,
    documentId: documentRow.id,
  };
}

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseNdjson(text: string): ExportedRow[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ExportedRow);
}

/** Snapshot every exported table's rows, order-independent (sorted by content). */
async function snapshotTables(
  db: Db,
): Promise<Record<string, Record<string, unknown>[]>> {
  const snapshot: Record<string, Record<string, unknown>[]> = {};
  for (const table of EXPORT_TABLE_ORDER) {
    const rows = await selectAll(db, table);
    snapshot[getTableName(table)] = rows.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return snapshot;
}

/**
 * `EXPORT_TABLE_ORDER` is deliberately heterogeneous (every persistent
 * table), so this is the one place `.from()` loses its concrete row type.
 */
async function selectAll(
  db: Db,
  table: (typeof EXPORT_TABLE_ORDER)[number],
): Promise<Record<string, unknown>[]> {
  // biome-ignore lint/suspicious/noExplicitAny: see function doc comment.
  const rows = await db.select().from(table as any);
  return rows as Record<string, unknown>[];
}

describe("DB export/import round trip (U3)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: Db;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase("magstacker_backup_test")
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  // Every test starts from a clean slate regardless of execution order —
  // wipeDatabase is exercised here as much as it is by the tests themselves.
  beforeEach(async () => {
    await wipeDatabase(db);
  });

  test("full seed round-trips through export -> wipe -> import with every table matching exactly (AE5/R10)", async () => {
    await seedFullInventory(db);
    const before = await snapshotTables(db);

    const exportText = await streamToString(exportDatabase(db));
    await wipeDatabase(db);

    // Confirm the wipe actually cleared every exported table before import
    // "fixes" it back up — otherwise a no-op import could pass by accident.
    const afterWipe = await snapshotTables(db);
    for (const rows of Object.values(afterWipe)) {
      expect(rows).toHaveLength(0);
    }

    await importDatabase(db, Readable.from([exportText]));
    const after = await snapshotTables(db);

    expect(after).toEqual(before);
  });

  test("FK-safe order lets firearm_document import immediately after its firearm with no constraint violation (R2 ordering)", async () => {
    const seeded = await seedFullInventory(db);
    const exportText = await streamToString(exportDatabase(db));
    await wipeDatabase(db);

    // If table-order.ts ever put firearm_document before firearm, this
    // insert would throw a foreign-key violation and the transaction (and
    // this test) would fail.
    await importDatabase(db, Readable.from([exportText]));

    const [document] = await db
      .select()
      .from(firearmDocument)
      .where(sql`${firearmDocument.id} = ${seeded.documentId}`);
    expect(document).toBeDefined();
    expect(document.firearmId).toBe(seeded.firearmId);
  });

  test("ephemeral session, rate_limit, and idempotency rows are excluded from the export", async () => {
    await seedFullInventory(db);
    const exportText = await streamToString(exportDatabase(db));
    const rows = parseNdjson(exportText);
    const exportedTableNames = new Set(rows.map((r) => r.table));

    for (const ephemeralTable of EPHEMERAL_TABLE_NAMES) {
      expect(exportedTableNames.has(ephemeralTable)).toBe(false);
    }
    // Sanity check the export isn't just empty — it does carry real rows.
    expect(rows.length).toBeGreaterThan(0);
  });

  test("table-order.ts's export order plus the ephemeral exclusion set covers exactly the live schema's tables (regression guard)", async () => {
    const liveTables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const liveTableNames = new Set(liveTables.rows.map((r) => r.table_name));

    const declaredTableNames = new Set([
      ...EXPORT_TABLE_ORDER.map((t) => getTableName(t)),
      ...EPHEMERAL_TABLE_NAMES,
    ]);

    const missingFromTableOrder = [...liveTableNames].filter(
      (name) => !declaredTableNames.has(name),
    );
    const staleInTableOrder = [...declaredTableNames].filter(
      (name) => !liveTableNames.has(name),
    );

    expect(missingFromTableOrder).toEqual([]);
    expect(staleInTableOrder).toEqual([]);
  });

  test("timestamptz, uuid, boolean, and integer columns round-trip exactly, not just structurally", async () => {
    const seeded = await seedFullInventory(db);
    const [beforeFirearm] = await db
      .select()
      .from(firearm)
      .where(sql`${firearm.id} = ${seeded.firearmId}`);
    const [beforeMagazine] = await db.select().from(magazine);

    const exportText = await streamToString(exportDatabase(db));
    await wipeDatabase(db);
    await importDatabase(db, Readable.from([exportText]));

    const [afterFirearm] = await db
      .select()
      .from(firearm)
      .where(sql`${firearm.id} = ${seeded.firearmId}`);
    const [afterMagazine] = await db.select().from(magazine);

    // uuid (primary key) — same string, not merely equal-looking.
    expect(afterFirearm.id).toBe(beforeFirearm.id);
    // boolean.
    expect(afterFirearm.isNfa).toBe(true);
    expect(beforeFirearm.isNfa).toBe(true);
    // timestamptz — reconstructed as a real Date with the same instant.
    expect(afterFirearm.createdAt).toBeInstanceOf(Date);
    expect(afterFirearm.createdAt.getTime()).toBe(
      beforeFirearm.createdAt.getTime(),
    );
    expect(afterFirearm.updatedAt.getTime()).toBe(
      beforeFirearm.updatedAt.getTime(),
    );
    // integer.
    expect(afterMagazine.baseCapacity).toBe(beforeMagazine.baseCapacity);
    expect(afterMagazine.baseCapacity).toBe(17);
  });

  test("import rejects a db.ndjson line larger than the cap, without inserting any rows (oversized-line DoS guard)", async () => {
    const validLine = `${JSON.stringify({
      table: "user",
      row: {
        id: randomUUID(),
        name: "Should Not Persist",
        email: `${randomUUID()}@example.test`,
      },
    } satisfies ExportedRow)}\n`;
    // Deliberately no trailing newline — the reader must reject this before
    // ever handing it to JSON.parse, not just at end-of-stream.
    const oversizedLine = JSON.stringify({
      table: "user",
      row: {
        id: randomUUID(),
        name: "x".repeat(MAX_NDJSON_LINE_BYTES + 1024),
        email: `${randomUUID()}@example.test`,
      },
    } satisfies ExportedRow);

    let caught: unknown;
    try {
      await importDatabase(db, Readable.from([validLine + oversizedLine]));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/longer than/i);

    // The whole import runs in one transaction — the oversized line's
    // rejection must roll back the earlier, otherwise-valid `user` insert
    // too, not leave a partially-applied import.
    const rows = await db.select().from(user);
    expect(rows).toHaveLength(0);
  });

  test("import still handles a final line with no trailing newline (no regression from switching off the readline-based reader)", async () => {
    const rows: ExportedRow[] = [
      {
        table: "user",
        row: {
          id: randomUUID(),
          name: "No Trailing Newline A",
          email: `${randomUUID()}@example.test`,
        },
      },
      {
        table: "user",
        row: {
          id: randomUUID(),
          name: "No Trailing Newline B",
          email: `${randomUUID()}@example.test`,
        },
      },
    ];
    const ndjson = rows.map((row) => JSON.stringify(row)).join("\n");

    await importDatabase(db, Readable.from([ndjson]));

    const persisted = await db.select().from(user);
    expect(persisted).toHaveLength(2);
  });
});
