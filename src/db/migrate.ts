import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { requireDatabaseUrl } from "./env";

/**
 * Apply all pending migrations against `DATABASE_URL`, then exit.
 *
 * Run explicitly (`bun run db:migrate`) or as the stack's migrate step on
 * container start. Drizzle records applied migrations in `__drizzle_migrations`,
 * so re-running is idempotent — already-applied migrations are skipped.
 */
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: requireDatabaseUrl() });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
