/**
 * Container health probe (issue #14, KTD4/KTD5).
 *
 * Run by the image `HEALTHCHECK` (Dockerfile) and the Compose `app` healthcheck
 * with `bun scripts/healthcheck.ts`, because the `oven/bun` slim image ships
 * neither curl nor wget. It hits `GET /api/health` on the container's own
 * loopback and exits 0 only on an exact 200 — a redirect is NOT followed and
 * counts as unhealthy (an auth-gate regression would otherwise 307 the probe to
 * `/login`, which a redirect-following fetch would happily report as healthy),
 * and a non-2xx or a network error exits 1. Reads `PORT` itself so the exec-form
 * HEALTHCHECK needs no shell for variable expansion.
 *
 * The decision is exported so `src/db/__tests__/healthcheck-script.test.ts`
 * can cover it without a server; the probe only runs when this file is the
 * script being executed directly.
 */
export const DEFAULT_PORT = 3000;

const MAX_TCP_PORT = 65_535;

/**
 * Nests between the route's worst case (2 x DEFAULT_PROBE_TIMEOUT_MS in
 * src/db/health.ts = 3 s) and the 5 s Dockerfile/Compose HEALTHCHECK timeout,
 * so a slow probe surfaces as the route's own 503 and a hung one as a script
 * abort — never as Docker killing the probe.
 */
export const REQUEST_TIMEOUT_MS = 4_000;

const HEALTHY_STATUS = 200;

export type ProbeExitCode = 0 | 1;

/** The slice of `fetch` the probe uses — narrow so tests can hand in a plain stub. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** `http://127.0.0.1:<PORT>/api/health`, falling back to port 3000 when PORT is unset or not a valid TCP port (1-65535). */
export function healthUrl(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const raw = env.PORT ?? "";
  // Whole-string check: parseInt would accept "4100foo" or "1.5" as numeric
  // prefixes and silently probe the wrong port.
  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  const isValidPort =
    Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_TCP_PORT;
  const port = isValidPort ? parsed : DEFAULT_PORT;
  return `http://127.0.0.1:${port}/api/health`;
}

/** Exit 0 only on an exact 200; anything else (503, a redirect, a thrown error) is 1. */
export async function probe(
  fetchImpl: FetchLike,
  env: Readonly<Record<string, string | undefined>>,
): Promise<ProbeExitCode> {
  try {
    const response = await fetchImpl(healthUrl(env), {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.status === HEALTHY_STATUS ? 0 : 1;
  } catch {
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await probe(fetch, process.env);
}
