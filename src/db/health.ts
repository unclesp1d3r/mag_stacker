import { Client } from "pg";
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

/**
 * Per-phase bound for `probeDatabase()`. It applies to the connect phase and
 * the query phase independently, so the worst case is 2x this value (3 s).
 * That nests under `scripts/healthcheck.ts`'s 4 s fetch budget, which nests
 * under the 5 s Dockerfile/Compose healthcheck timeout — keep all three in
 * that order when changing any of them.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 1_500;

/** How long a probe waits for Postgres to acknowledge Terminate before the socket is destroyed. */
const PROBE_CLOSE_TIMEOUT_MS = 500;

let inFlightProbe: Promise<boolean> | undefined;

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
 *
 * Single-flight: the route is unauthenticated, so concurrent callers share the
 * one outstanding probe instead of each opening a Postgres connection. Never
 * rejects — every failure, including a missing `DATABASE_URL`, is `false`.
 */
export function probeDatabase(
  options: { timeoutMs?: number } = {},
): Promise<boolean> {
  if (inFlightProbe) return inFlightProbe;
  inFlightProbe = runProbe(options).finally(() => {
    inFlightProbe = undefined;
  });
  return inFlightProbe;
}

async function runProbe({
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
}: {
  timeoutMs?: number;
}): Promise<boolean> {
  let client: Client | undefined;
  try {
    client = new Client({
      connectionString: requireDatabaseUrl(),
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
    });
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    if (client) await closeQuietly(client);
  }
}

/**
 * `client.end()` sends Terminate and resolves only when the peer closes the
 * socket; a peer that never does would hang the probe. Bound it, then destroy
 * the socket if it did not settle. pg has no public force-close, so this
 * reaches its untyped `connection.stream`; a missing stream is a no-op.
 */
async function closeQuietly(client: Client): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), PROBE_CLOSE_TIMEOUT_MS);
  });
  const closed = client.end().then(
    () => "closed" as const,
    () => "closed" as const,
  );
  const outcome = await Promise.race([closed, deadline]);
  clearTimeout(timer);
  if (outcome === "timeout") {
    const internals = client as unknown as {
      connection?: { stream?: { destroy: () => void } };
    };
    internals.connection?.stream?.destroy();
  }
}
