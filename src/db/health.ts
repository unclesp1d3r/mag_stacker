import { sql } from "drizzle-orm";
import { Client } from "pg";
import { db } from "./client";
import { requireDatabaseUrl } from "./env";

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

/** Default bound for `probeDatabase()`: well inside the container healthcheck timeout. */
export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

/**
 * Bounded readiness probe for `GET /api/health` (issue #14, KTD2).
 *
 * Deliberately NOT the shared pool: a probe raced against a timer through the
 * pool would bound only the HTTP response, and against a database host that
 * accepts TCP but never answers it would pin one pool client per poll with
 * nothing to release it — exhausting the default pool of 10 in under two
 * minutes and starving every other route during exactly the outage the probe
 * exists to detect. A dedicated client costs one extra TCP connection per poll
 * and can carry its own connect and query timeouts.
 */
export async function probeDatabase({
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
}: {
  timeoutMs?: number;
} = {}): Promise<boolean> {
  const client = new Client({
    connectionString: requireDatabaseUrl(),
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
  });
  try {
    await client.connect();
    await client.query("select 1");
    await client.end();
    return true;
  } catch {
    // pg destroys the socket itself on a connect timeout; on a query timeout
    // the connection is still open, so send Terminate. Not awaited: against a
    // black-holed peer `end()` could wait for a FIN that never arrives, and the
    // dedicated client has nothing else to protect.
    client.end().catch(() => {});
    return false;
  }
}
