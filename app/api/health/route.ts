import { DEFAULT_PROBE_TIMEOUT_MS, probeDatabase } from "@/src/db/health";
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
    // The probe itself logs one warn line per failed probe (single-flight
    // leader), so concurrent callers sharing a failure do not multiply it.
    return Response.json(
      { status: "unavailable", db: "unreachable" },
      { status: 503, headers: HEADERS },
    );
  },
);
