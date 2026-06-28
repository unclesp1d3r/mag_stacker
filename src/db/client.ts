import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { requireDatabaseUrl } from "./env";
import * as schema from "./schema";

/**
 * Long-running connection pool for the homelab deployment (not serverless).
 *
 * A single pool is shared across the app process. `requireDatabaseUrl()` fails
 * fast at first access if the connection string is missing.
 */
export const pool = new Pool({ connectionString: requireDatabaseUrl() });

/** Drizzle handle bound to the shared pool and the full schema. Server-side only. */
export const db = drizzle(pool, { schema });

export type Database = typeof db;

/** Close the pool — used by tests and graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool.end();
}
