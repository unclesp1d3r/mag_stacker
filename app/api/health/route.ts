import { DEFAULT_PROBE_TIMEOUT_MS, probeDatabase } from "@/src/db/health";
import { logger } from "@/src/lib/logging";
import { withRequestContext } from "@/src/lib/logging/entry-context";

/**
 * Unauthenticated health surface (issue #14). 200 when the app is serving and
 * Postgres answers a dedicated, timeout-bounded probe (KTD2); 503 otherwise.
 * The body is fixed and carries no connection details or error text (R4).
 * Docker `HEALTHCHECK` and the Compose `app` healthcheck both hit this route
 * through `scripts/healthcheck.ts`; `proxy.ts` excludes it from the auth gate.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" } as const;

export const GET = withRequestContext(
  "health",
  async (_req: Request): Promise<Response> => {
    const isDatabaseReachable = await probeDatabase({
      timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    });
    if (isDatabaseReachable) {
      return Response.json({ status: "ok", db: "ok" }, { headers: HEADERS });
    }
    // One line per failed probe, no cause (the probe returns only a boolean),
    // so an outage is visible in the logs without leaking connection details.
    logger.warn("health probe: database unreachable");
    return Response.json(
      { status: "unavailable", db: "unreachable" },
      { status: 503, headers: HEADERS },
    );
  },
);
