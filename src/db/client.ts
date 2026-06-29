import type { ExtractTablesWithRelations } from "drizzle-orm";
import {
  drizzle,
  type NodePgDatabase,
  type NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { requireDatabaseUrl } from "./env";
import * as schema from "./schema";

/** Drizzle handle bound to the shared pool and the full schema. Server-side only. */
export type Database = NodePgDatabase<typeof schema>;

/**
 * Long-running connection pool for the homelab deployment (not serverless).
 *
 * Construction is deferred to first use: importing this module must NOT require
 * `DATABASE_URL`, so server modules can be imported during `next build` without
 * a database. `requireDatabaseUrl()` then fails fast at first *access* (a query),
 * exactly as documented in `env.ts`.
 */
let activePool: Pool | undefined;
let activeDb: Database | undefined;

function connect(): { pool: Pool; db: Database } {
  if (!activePool || !activeDb) {
    activePool = new Pool({ connectionString: requireDatabaseUrl() });
    activeDb = drizzle(activePool, { schema });
  }
  return { pool: activePool, db: activeDb };
}

/** Lazy proxy: forwards to the real object built on first property access. */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const real = resolve() as object;
      const value = Reflect.get(real, prop, real);
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
}

/** Shared connection pool (lazily constructed on first access). */
export const pool: Pool = lazy(() => connect().pool);

/** Drizzle handle bound to the shared pool (lazily constructed on first access). */
export const db: Database = lazy(() => connect().db);

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
  if (activePool) {
    await activePool.end();
    activePool = undefined;
    activeDb = undefined;
  }
}
