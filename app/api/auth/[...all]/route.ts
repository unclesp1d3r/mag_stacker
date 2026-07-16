import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/auth";
import { withRequestContext } from "@/src/lib/logging/entry-context";

// Mounts every Better Auth endpoint (sign-in, sign-out, admin, get-session, ...)
// at the recommended base path `/api/auth/*`. Excluded from the proxy gate.
// Wrapped with withRequestContext so every Better Auth log line carries a
// correlation id (R10); the delegation contract is otherwise unchanged —
// each wrapped function still forwards straight to Better Auth's own
// `(request: Request) => Promise<Response>` handler and returns its
// Response unmodified.
const handlers = toNextJsHandler(auth);
export const GET = withRequestContext("auth", handlers.GET);
export const POST = withRequestContext("auth", handlers.POST);
