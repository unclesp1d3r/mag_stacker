import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { ACCESSORY_TYPES } from "@/src/domain/accessories/constants";
import { expectRejects } from "@/src/test-support/assertions";
import { POSTGRES_IMAGE } from "@/src/test-support/postgres-image";

/**
 * Covers `0022_confused_lockheed.sql`'s hand-written backfill (#23 R2, AE6) —
 * the one step in this plan that runs EXACTLY ONCE against real owner data and
 * cannot be re-run to fix a bad mapping.
 *
 * `bunfig.toml`'s preload migrates a shared container once against an empty
 * database, so in every other test file 0022's `UPDATE` matches zero rows and
 * the mapping is never exercised. This file stands up its own ephemeral
 * Postgres, migrates it through 0021 ONLY, seeds accessories carrying the
 * free-text categories #8 shipped, and only THEN applies 0022 — so the real
 * mapping runs against real pre-migration rows.
 *
 * Mirrors `migration-0020-service-event-conversion.test.ts`, including its
 * truncate-by-INDEX rule: see `buildMigrationsFolderThrough0021`.
 */

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

interface AccessoryRow {
  id: string;
  type: string;
  category: string;
  serial_number: string;
}

const REPO_MIGRATIONS_DIR = path.join(process.cwd(), "src/db/migrations");
const MIGRATION_0022_TAG = "0022_confused_lockheed";

const tempDirs: string[] = [];

/**
 * The migrations folder truncated to everything BEFORE 0022, by journal INDEX
 * rather than by tag.
 *
 * Slicing at the index (not filtering 0022's own entry) is load-bearing:
 * drizzle's migrator applies every journal entry newer than the newest `when`
 * the database has already recorded — it does NOT hash each file. Leaving a
 * migration that ships after 0022 in this folder would apply it here, making
 * its `when` the recorded high-water mark, and 0022's older `when` would then
 * read as already-applied and be silently skipped — the backfill would never
 * run and this whole file would pass vacuously.
 */
function buildMigrationsFolderThrough0021(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "u1-migrations-"));
  cpSync(REPO_MIGRATIONS_DIR, dir, { recursive: true });
  tempDirs.push(dir);

  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  const cutoffIndex = journal.entries.findIndex(
    (e) => e.tag === MIGRATION_0022_TAG,
  );
  if (cutoffIndex === -1) {
    throw new Error(
      `${MIGRATION_0022_TAG} not found in the journal — has it been renamed?`,
    );
  }
  for (const entry of journal.entries.slice(cutoffIndex)) {
    rmSync(path.join(dir, `${entry.tag}.sql`));
  }
  writeFileSync(
    journalPath,
    JSON.stringify(
      { ...journal, entries: journal.entries.slice(0, cutoffIndex) },
      null,
      2,
    ),
  );
  return dir;
}

async function runMigrations(
  pool: Pool,
  migrationsFolder: string,
): Promise<void> {
  const db: NodePgDatabase = drizzle(pool);
  await migrate(db, { migrationsFolder });
}

describe("migration 0022 — accessory type backfill (real pre-migration data)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let userId: string;
  let byCategory: Map<string, AccessoryRow>;

  /**
   * Every fixture is keyed by its serial so assertions never depend on row
   * order. `category` values are the ones #8's suggestion list actually
   * shipped, plus the awkward real-world shapes free text guarantees:
   * mixed case, surrounding whitespace, a multi-word type, and a long-tail
   * value with no controlled equivalent.
   */
  const FIXTURES: {
    serial: string;
    category: string;
    expectedType: string;
  }[] = [
    {
      serial: "fx-suppressor",
      category: "suppressor",
      expectedType: "suppressor",
    },
    { serial: "fx-mixed-case", category: "Optic", expectedType: "optic" },
    { serial: "fx-upper", category: "LASER", expectedType: "laser" },
    { serial: "fx-whitespace", category: "  light  ", expectedType: "light" },
    {
      serial: "fx-multiword",
      category: "muzzle device",
      expectedType: "muzzle device",
    },
    // The long tail #8 deliberately allowed — must NOT be forced into a
    // controlled type, and must keep its category verbatim (AE6).
    { serial: "fx-longtail", category: "bipod", expectedType: "other" },
    { serial: "fx-freeform", category: "red dot mount", expectedType: "other" },
    // `category` was NOT NULL but had no default pre-0022, so an empty string
    // was always reachable.
    { serial: "fx-empty", category: "", expectedType: "other" },
  ];

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase(`u1_${randomUUID().replaceAll("-", "")}`)
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await runMigrations(pool, buildMigrationsFolderThrough0021());

    userId = `test-user-${randomUUID()}`;
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`,
      [userId, "Backfill Owner", `${userId}@example.test`],
    );

    for (const fixture of FIXTURES) {
      await pool.query(
        `INSERT INTO accessory (owner_id, category, serial_number)
         VALUES ($1, $2, $3)`,
        [userId, fixture.category, fixture.serial],
      );
    }

    // Sanity: the column genuinely does not exist yet, so a pass here can't be
    // an artifact of 0022 having already run.
    const { rows: preColumns } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'accessory' AND column_name = 'type'`,
    );
    expect(preColumns).toHaveLength(0);

    // Verification (#23 U1): the SHIPPED, unmodified migrations folder.
    await runMigrations(pool, REPO_MIGRATIONS_DIR);

    const { rows } = await pool.query<AccessoryRow>(
      `SELECT id, type, category, serial_number FROM accessory`,
    );
    byCategory = new Map(rows.map((r) => [r.serial_number, r]));
  }, 90_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  }, 30_000);

  test("every pre-existing accessory lands with a type in the controlled set", () => {
    expect(byCategory.size).toBe(FIXTURES.length);
    for (const row of byCategory.values()) {
      expect(ACCESSORY_TYPES).toContain(
        row.type as (typeof ACCESSORY_TYPES)[number],
      );
    }
  });

  test.each(FIXTURES)(
    "category $category backfills to type $expectedType",
    ({ serial, expectedType }) => {
      expect(byCategory.get(serial)?.type).toBe(expectedType);
    },
  );

  test("AE6: an unmapped long-tail category is preserved verbatim, not rewritten", () => {
    expect(byCategory.get("fx-longtail")?.category).toBe("bipod");
    expect(byCategory.get("fx-longtail")?.type).toBe("other");
    expect(byCategory.get("fx-freeform")?.category).toBe("red dot mount");
  });

  test("the backfill never rewrites category, even when it DID map to a type", () => {
    // Losslessness is the property that makes this one-shot migration safe to
    // revisit later with a better mapping.
    expect(byCategory.get("fx-mixed-case")?.category).toBe("Optic");
    expect(byCategory.get("fx-whitespace")?.category).toBe("  light  ");
  });

  test("the accessory_type_valid CHECK is live — an out-of-set type is rejected", async () => {
    await expectRejects(() =>
      pool.query(
        `INSERT INTO accessory (owner_id, category, type) VALUES ($1, 'x', 'bipod')`,
        [userId],
      ),
    );
  });

  test("category is now optional — an insert omitting it defaults to empty", async () => {
    const { rows } = await pool.query<{ category: string }>(
      `INSERT INTO accessory (owner_id, type) VALUES ($1, 'suppressor')
       RETURNING category`,
      [userId],
    );
    expect(rows[0]?.category).toBe("");
  });

  test("accessory is now a legal grant parent_type, and its cleanup trigger fires on delete", async () => {
    const granteeId = `test-grantee-${randomUUID()}`;
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`,
      [granteeId, "Grantee", `${granteeId}@example.test`],
    );
    const { rows: created } = await pool.query<{ id: string }>(
      `INSERT INTO accessory (owner_id, type) VALUES ($1, 'suppressor') RETURNING id`,
      [userId],
    );
    const accessoryId = created[0]?.id ?? "";

    // The widened grant_parent_type_valid CHECK (U4) accepts 'accessory'.
    await pool.query(
      `INSERT INTO "grant" (owner_id, grantee_id, parent_type, parent_id, permission)
       VALUES ($1, $2, 'accessory', $3, 'view')`,
      [userId, granteeId, accessoryId],
    );

    await pool.query(`DELETE FROM accessory WHERE id = $1`, [accessoryId]);

    const { rows: remaining } = await pool.query(
      `SELECT id FROM "grant" WHERE parent_type = 'accessory' AND parent_id = $1`,
      [accessoryId],
    );
    expect(remaining).toHaveLength(0);
  });
});

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});
