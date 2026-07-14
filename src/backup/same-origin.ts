/**
 * Explicit same-origin (CSRF) guard for the admin backup routes (hardening
 * pass on plan Unit U6).
 *
 * `app/api/admin/backup/export/route.ts` and `.../restore/route.ts` are the
 * highest-blast-radius endpoints in the app (whole-instance export/restore).
 * They are plain Next.js Route Handlers, never routed through Better Auth's
 * own request handler — so Better Auth's origin handling (`BETTER_AUTH_URL`
 * / `trustedOrigins`) never sees them, and the session cookie's `sameSite`
 * attribute is the only implicit CSRF protection they had. `sameSite` alone
 * is not a substitute for an explicit check on a route this sensitive
 * (older browsers, subdomain edge cases, misconfigured proxies), so both
 * routes call {@link sameOriginError} right after their admin gate and
 * return its 403 verbatim when it is non-null.
 *
 * Same-origin is decided from, in order:
 * 1. `Origin` — present on essentially every modern-browser POST, same- or
 *    cross-origin (the Fetch spec has required it on state-changing
 *    requests for years). Covers both the restore panel's `fetch()` and,
 *    in practice, the export panel's real `<form method="POST">` submit too.
 * 2. `Referer` — a fallback for the rare navigation that omits `Origin`
 *    (some older/`Referrer-Policy`-restricted same-origin form
 *    navigations). This is the case the export route specifically needs the
 *    fallback for.
 * 3. `Sec-Fetch-Site` — a Fetch-Metadata header some browsers attach even
 *    when neither of the above is present; `"same-origin"`/`"none"` (a
 *    direct, non-navigational request) are accepted, anything else refused.
 *
 * A request carrying none of the three is refused outright rather than
 * assumed same-origin — every legitimate same-origin POST from this app's
 * own export form or restore panel supplies at least one.
 */
export function sameOriginError(request: Request): Response | null {
  const acceptable = acceptableOrigins(request);

  const origin = request.headers.get("origin");
  if (origin !== null) {
    return acceptable.has(origin) ? null : mismatch();
  }

  const referer = request.headers.get("referer");
  if (referer !== null) {
    const refererOrigin = safeOrigin(referer);
    return refererOrigin !== null && acceptable.has(refererOrigin)
      ? null
      : mismatch();
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null) {
    return secFetchSite === "same-origin" || secFetchSite === "none"
      ? null
      : mismatch();
  }

  return mismatch();
}

/**
 * The set of origins this request may legitimately have come from: the
 * origin the request itself arrived on (derived from `request.url`, i.e.
 * the `Host` Next.js resolved the request against), plus `BETTER_AUTH_URL`'s
 * origin when configured — the same env var `auth.ts`/Better Auth treats as
 * this deployment's canonical public origin (see `AGENTS.md`: "`BETTER_AUTH_URL`
 * must equal the request origin"). Accepting both, rather than only one,
 * keeps this correct whether or not a reverse proxy rewrites `Host`.
 */
function acceptableOrigins(request: Request): ReadonlySet<string> {
  const origins = new Set<string>([new URL(request.url).origin]);
  const configured = process.env.BETTER_AUTH_URL;
  if (configured) {
    const configuredOrigin = safeOrigin(configured);
    if (configuredOrigin !== null) origins.add(configuredOrigin);
  }
  return origins;
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function mismatch(): Response {
  return new Response(null, { status: 403 });
}
