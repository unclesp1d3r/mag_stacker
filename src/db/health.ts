import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * Database availability surface (U12, R74). Store-backed operations that hit an
 * unreachable database surface a clear, non-leaking error; pure endpoints
 * (reference data, validation) never call this and stay available during an
 * outage.
 */
export class DatabaseUnavailableError extends Error {
  constructor() {
    super("The database is currently unavailable. Please try again shortly.");
    this.name = "DatabaseUnavailableError";
  }
}

// Postgres connection-class SQLSTATEs + Node socket error codes.
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "EHOSTUNREACH",
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
]);

export function isConnectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && CONNECTION_ERROR_CODES.has(code);
}

/**
 * Wrap a store-backed operation so a connection failure becomes a clear,
 * non-leaking `DatabaseUnavailableError`. Other errors propagate unchanged.
 */
export async function withDatabase<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (isConnectionError(error)) {
      throw new DatabaseUnavailableError();
    }
    throw error;
  }
}

/** Liveness probe — true when `select 1` succeeds. */
export async function checkDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
