import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Server, type Socket } from "node:net";
import { closePool, pool } from "@/src/db/client";
import { containerTest } from "../../test-support/container-test";

/**
 * `GET /api/health` contract (issue #14, R1–R6).
 *
 * The route probes Postgres over its own short-lived client (KTD2), never the
 * shared pool, so this file can repoint `DATABASE_URL` at throwaway sockets
 * without touching the pool other files share. The one shared-state seam is
 * the lazy `db`/`pool` singleton in `src/db/client.ts`: `afterAll` closes it
 * and restores `DATABASE_URL`, mirroring `src/backup/__tests__/routes.test.ts`.
 */
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

const HEALTH_URL = "http://localhost/api/health";

async function getHealth(): Promise<Response> {
  const { GET } = await import("@/app/api/health/route");
  return GET(new Request(HEALTH_URL));
}

/** Reserve an OS-assigned port and release it, so a connect to it is refused. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not reserve a TCP port.");
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

/** A listener that accepts connections and never writes a byte back. */
async function blackHole(): Promise<{
  port: number;
  stop: () => Promise<void>;
}> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not start the black-hole listener.");
  }
  return {
    port: address.port,
    stop: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function pointDatabaseAt(port: number): void {
  process.env.DATABASE_URL = `postgres://probe:probe@127.0.0.1:${port}/probe`;
}

function restoreDatabaseUrl(): void {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
}

describe("GET /api/health (U1)", () => {
  afterAll(async () => {
    await closePool();
    restoreDatabaseUrl();
  });

  test("covers AE1: returns 200 and the ok body when the database is reachable", async () => {
    restoreDatabaseUrl();
    const response = await getHealth();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", db: "ok" });
  });

  test("covers AE2: returns 503 and a body with no connection details when the database refuses connections", async () => {
    const port = await closedPort();
    pointDatabaseAt(port);
    const response = await getHealth();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      status: "unavailable",
      db: "unreachable",
    });
    for (const secret of [
      String(port),
      "127.0.0.1",
      "localhost",
      "postgres",
      "ECONNREFUSED",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  containerTest(
    "covers AE3: returns 503 within the time bound when the database accepts but never answers, without borrowing from the shared pool",
    async () => {
      const hole = await blackHole();
      try {
        pointDatabaseAt(hole.port);
        const poolClientsBefore = pool.totalCount;
        const started = performance.now();
        const response = await getHealth();
        const elapsedMs = performance.now() - started;
        expect(response.status).toBe(503);
        expect(elapsedMs).toBeLessThan(3_000);
        expect(pool.totalCount).toBe(poolClientsBefore);
      } finally {
        await hole.stop();
      }
    },
  );

  test("recovers: returns 200 again once the database is reachable", async () => {
    restoreDatabaseUrl();
    await closePool();
    const response = await getHealth();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", db: "ok" });
  });
});
