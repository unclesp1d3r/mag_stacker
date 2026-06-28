import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic auth gate (Next 16 `proxy.ts`, KTD-6).
 *
 * Proxy runs on every matched request including prefetches, so it does only a
 * cookie-presence/signature check — NO database call. This is NOT the
 * authorization boundary: full session resolution happens in server components,
 * Server Actions, and Route Handlers where U4's scoping layer runs (R66). A
 * forged cookie passes here but fails the real check downstream.
 *
 * The matcher covers all gated routes and `/api/export`, and excludes
 * `/api/auth/**`, `/_next/**`, static assets, and the login route.
 */
export function proxy(request: NextRequest): NextResponse {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except the Better Auth endpoints, the login route,
    // Next internals, and static asset files.
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
