import { getCurrentUser, type SessionUser } from "@/src/auth/session";
import { type ActionResult, toActionError } from "@/src/domain/action-result";
import { mintCorrelationId, runWithContext } from "@/src/lib/logging";

/**
 * Single entry-point wrapper for `"use server"` actions (R10, R19, KTD-4).
 * Resolves the session, mints a correlation id, seeds the ALS context with
 * the fields known at entry (`correlationId`, `entrypoint`, actor id + display
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
  entrypoint: string,
  handler: (userId: string) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) return toActionError(new Error("Unauthenticated"));

  const correlationId = mintCorrelationId();
  return runWithContext(
    { correlationId, entrypoint, actorId: user.id, actorName: user.name },
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
  entrypoint: string,
  handler: (user: SessionUser | null) => Promise<T>,
): Promise<T> {
  const user = await getCurrentUser();
  const correlationId = mintCorrelationId();
  return runWithContext(
    { correlationId, entrypoint, actorId: user?.id, actorName: user?.name },
    () => handler(user),
  );
}

/**
 * Entry-point wrapper for `Request → Response` route handlers. Mints a
 * correlation id — honoring an inbound `x-request-id` header when present,
 * so a caller-supplied trace id survives — and runs `handler(...args)` inside
 * that context. Does not resolve a user: route handlers vary widely in
 * whether/how they authenticate.
 *
 * Forwards ALL arguments (not just `req`) so it works for Next.js's
 * dynamic-segment route handlers, whose second parameter carries
 * `{ params: Promise<...> }` — `(req, ctx) => Promise<Response>` — as well as
 * plain `(req) => Promise<Response>` handlers.
 *
 * The generic is bounded to `[Request, ...unknown[]]` so the first argument is
 * guaranteed to be the `Request` — Next.js always invokes route handlers with
 * one — which keeps the inbound-`x-request-id` read sound without a cast. A
 * handler that ignores the request must still declare it (`(_req) => ...`).
 */
export function withRequestContext<A extends [Request, ...unknown[]]>(
  entrypoint: string,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return (...args: A) => {
    const [req] = args;
    const inbound = req.headers.get("x-request-id")?.trim();
    const correlationId = inbound ? inbound : mintCorrelationId();
    return runWithContext({ correlationId, entrypoint }, () =>
      handler(...args),
    );
  };
}
