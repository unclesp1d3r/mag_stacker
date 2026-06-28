import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
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

/** A Drizzle transaction handle over the full schema. */
export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Accept either the pooled client or an open transaction. Authorization and
 * domain helpers take this so the same code runs standalone or inside a
 * transaction (e.g. create-on-behalf and idempotency checks happen in the same
 * transaction as the insert — KTD-5, KTD-9).
 */
export type DbOrTx = Database | Transaction;

/** Close the pool — used by tests and graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool.end();
}
