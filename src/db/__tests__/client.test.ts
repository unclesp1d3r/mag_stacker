import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { requireDatabaseUrl } from "../env";

describe("requireDatabaseUrl (boundary validation, no DB needed)", () => {
  test("throws a clear error when DATABASE_URL is unset", () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => requireDatabaseUrl()).toThrow(/DATABASE_URL is not set/);
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original;
    }
  });

  test("throws when DATABASE_URL is blank whitespace", () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "   ";
    try {
      expect(() => requireDatabaseUrl()).toThrow(/DATABASE_URL is not set/);
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original;
      else delete process.env.DATABASE_URL;
    }
  });

  test("returns the connection string when set", () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://user:pass@host:5432/db";
    try {
      expect(requireDatabaseUrl()).toBe("postgres://user:pass@host:5432/db");
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original;
      else delete process.env.DATABASE_URL;
    }
  });
});

// The live-connection tests require a reachable Postgres (the compose `db`
// service). They are skipped when DATABASE_URL is not configured so the pure
// suite still runs in environments without a database.
const liveDb = process.env.DATABASE_URL ? describe : describe.skip;

liveDb("live Postgres connection", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  afterAll(async () => {
    await pool.end();
  });

  test("connects and runs `select 1`", async () => {
    const result = await db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toEqual({ one: 1 });
  });

  // Activates once real migrations exist (U3 adds the first schema migration
  // and its journal). Until then there is nothing to apply.
  const folder = "./src/db/migrations";
  const hasMigrations = existsSync(`${folder}/meta/_journal.json`);
  const migrateTest = hasMigrations ? test : test.skip;

  migrateTest(
    "the migrate step applies cleanly and is idempotent on re-run",
    async () => {
      // Applying the migration set twice must not error and must not duplicate
      // objects — the second run is a no-op against __drizzle_migrations.
      await migrate(db, { migrationsFolder: folder });
      await migrate(db, { migrationsFolder: folder });
      expect(true).toBe(true);
    },
  );
});
