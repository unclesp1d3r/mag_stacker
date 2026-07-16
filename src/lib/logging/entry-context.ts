import { getCurrentUser, type SessionUser } from "@/src/auth/session";
import { type ActionResult, toActionError } from "@/src/domain/action-result";
import { mintCorrelationId, runWithContext } from "@/src/lib/logging";

/**
 * Single entry-point wrapper for `"use server"` actions (R10, R19, KTD-4).
 * Resolves the session, mints a correlation id, seeds the ALS context with
 * the fields known at entry (`correlationId`, `module`, actor id + display
 * name), runs `handler`, and funnels any thrown error through the shared
 * `toActionError` chokepoint (KTD-7). This *replaces* the previous per-file
 * `requireUserId()` + `try/catch/toActionError` boilerplate.
 *
 * `ownerId` is deliberately NOT seeded here — `getCurrentUser()` exposes no
 * owner id, and the true owner is only resolved inside the service
 * transaction (see plan KTD-4). Callers that have resolved an owner attach
 * it as a per-line field at that point instead.
 */
export async function withActionContext<T>(
  module: string,
  handler: (userId: string) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) return toActionError(new Error("Unauthenticated"));

  const correlationId = mintCorrelationId();
  return runWithContext(
    { correlationId, module, actorId: user.id, actorName: user.name },
    async () => {
      try {
        return await handler(user.id);
      } catch (error) {
        return toActionError(error);
      }
    },
  );
}

/**
 * Entry-point wrapper for the admin surface (`app/(admin)/users/actions.ts`).
 * Unlike `withActionContext`, this does not itself assert admin or funnel
 * errors through `toActionError` — the admin actions keep their existing
 * `requireAdmin()` / `assertWritesAllowed(db)` gates and bespoke error
 * mapping (their local `ActionResult` shape predates and differs from the
 * domain `ActionResult<T>`). This wrapper's only job is to resolve the
 * session once and seed the ALS context so admin-action log lines carry a
 * correlation id and the acting user, when one is resolved.
 */
export async function withAdminActionContext<T>(
  module: string,
  handler: (user: SessionUser | null) => Promise<T>,
): Promise<T> {
  const user = await getCurrentUser();
  const correlationId = mintCorrelationId();
  return runWithContext(
    { correlationId, module, actorId: user?.id, actorName: user?.name },
    () => handler(user),
  );
}

/**
 * Entry-point wrapper for `Request → Response` route handlers. Mints a
 * correlation id — honoring an inbound `x-request-id` header when present,
 * so a caller-supplied trace id survives — and runs `handler(req)` inside
 * that context. Does not resolve a user: route handlers vary widely in
 * whether/how they authenticate.
 */
export function withRequestContext(
  module: string,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return (req: Request) => {
    const inbound = req.headers.get("x-request-id")?.trim();
    const correlationId = inbound ? inbound : mintCorrelationId();
    return runWithContext({ correlationId, module }, () => handler(req));
  };
}
